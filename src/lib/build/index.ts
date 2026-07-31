/**
 * Mobile build normalization for `sentry build upload`.
 *
 * Detects the build format from ZIP entry names and wraps the build into a
 * deterministic ZIP (STORE compression, fixed mtime) alongside a metadata
 * file, ready for chunk upload + assembly.
 *
 * Determinism matters: a byte-identical wrapper for an identical build lets the
 * server dedup already-uploaded chunks across re-uploads. We use STORE (level 0)
 * because APK/AAB/IPA are themselves already-compressed ZIPs — re-compressing
 * the wrapper would cost CPU for ~no size win — and a fixed modification time so
 * the output does not vary run to run.
 *
 * Note: the legacy Rust CLI compresses the wrapper with Zstd. STORE is chosen
 * here deliberately (simpler, no method-93 ZIP writer needed, avoids
 * double-compression). The tradeoff is that wrapper bytes differ from the Rust
 * CLI's, so chunks are not deduplicated across the two CLIs — only within this
 * one, which is what matters for repeated uploads from the same tool.
 *
 * Handles Android APK/AAB (file wrappers) and iOS XCArchive (directory) / IPA
 * (converted to an XCArchive layout). Unlike the legacy CLI, iOS is not gated to
 * Apple Silicon — the only native dependency was `Assets.car` parsing, which is
 * intentionally skipped (see `normalizeBuildDirectory`).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { strToU8, unzipSync, type Zippable, zipSync } from "fflate";
import { CLI_VERSION } from "../constants.js";
import { ValidationError } from "../errors.js";
import { logger } from "../logger.js";

const log = logger.withTag("build.normalize");

/** A recognized mobile build format. */
export type BuildFormat = "apk" | "aab" | "ipa" | "xcarchive";

/** ZIP local-file-header magic bytes (`PK\x03\x04`). */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Fixed modification time for normalized ZIP entries. A constant timestamp
 * (the ZIP epoch, 1980-01-01) keeps the wrapper byte-deterministic so identical
 * builds produce identical chunks.
 */
const FIXED_MTIME = new Date("1980-01-01T00:00:00Z");

/** Name of the metadata file embedded in every normalized build ZIP. */
const METADATA_FILENAME = ".sentry-cli-metadata.txt";

/** Whether the bytes start with the ZIP local-file-header magic. */
function hasZipMagic(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, i) => bytes[i] === byte);
}

/**
 * List a ZIP's entry names without decompressing any entry.
 *
 * The fflate filter is invoked for every entry; returning `false` skips
 * decompression, so this only parses the central directory.
 */
function listZipEntryNames(content: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(content, {
    filter: (file) => {
      names.push(file.name);
      return false;
    },
  });
  return names;
}

/**
 * Detect the mobile build format from a file's bytes.
 *
 * APK/AAB/IPA are recognized by their ZIP entry names. Returns `null` for
 * anything unrecognized. (XCArchive is a directory, not a file, and is detected
 * by the caller.)
 *
 * @param content - The raw build file bytes.
 */
export function detectBuildFormat(content: Uint8Array): BuildFormat | null {
  if (!hasZipMagic(content)) {
    return null;
  }

  let names: string[];
  try {
    names = listZipEntryNames(content);
  } catch (err) {
    log.debug("Failed to read ZIP entries while detecting build format", err);
    return null;
  }

  const entries = new Set(names);
  // AAB is more specific than APK (an AAB also nests an AndroidManifest under
  // base/), so check it first.
  if (
    entries.has("BundleConfig.pb") &&
    entries.has("base/manifest/AndroidManifest.xml")
  ) {
    return "aab";
  }
  if (entries.has("AndroidManifest.xml")) {
    return "apk";
  }
  // IPA: a Payload/<name>.app/Info.plist entry (recognized so the caller can
  // emit an "iOS not yet supported" message rather than "unrecognized").
  if (names.some((name) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(name))) {
    return "ipa";
  }
  return null;
}

/** A Sentry build plugin parsed from `SENTRY_PIPELINE`. */
export type PipelinePlugin = { name: string; version: string };

/**
 * Parse a recognized Sentry plugin from a `SENTRY_PIPELINE` value.
 *
 * Format: `"<name>/<version>"` (e.g. `"sentry-gradle-plugin/4.12.0"`). Only the
 * gradle and fastlane plugins are recognized; anything else yields `null`.
 *
 * @param pipeline - The `SENTRY_PIPELINE` value, if set.
 */
export function parsePluginFromPipeline(
  pipeline: string | undefined
): PipelinePlugin | null {
  if (!pipeline) {
    return null;
  }
  const slash = pipeline.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const name = pipeline.slice(0, slash);
  const version = pipeline.slice(slash + 1);
  if (
    version &&
    (name === "sentry-gradle-plugin" || name === "sentry-fastlane-plugin")
  ) {
    return { name, version };
  }
  return null;
}

/** Build the `.sentry-cli-metadata.txt` contents. */
function buildMetadataFile(plugin: PipelinePlugin | null): string {
  const version =
    process.env.SENTRY_CLI_INTEGRATION_TEST_VERSION_OVERRIDE ?? CLI_VERSION;
  let out = `sentry-cli-version: ${version}\n`;
  if (plugin) {
    out += `${plugin.name}: ${plugin.version}\n`;
  }
  return out;
}

/**
 * Wrap a build file into a deterministic normalized ZIP for upload.
 *
 * The ZIP stores the build under its basename plus `.sentry-cli-metadata.txt`,
 * using STORE (no compression) and a fixed mtime so identical inputs produce
 * identical bytes.
 *
 * @param filePath - Path to the build file (its basename becomes the ZIP entry).
 * @param content - The raw build file bytes.
 * @param plugin - Optional plugin identity for the metadata file.
 * @returns The normalized ZIP bytes.
 */
export function normalizeBuildFile(
  filePath: string,
  content: Uint8Array,
  plugin: PipelinePlugin | null
): Buffer {
  const entryOptions = { level: 0 as const, mtime: FIXED_MTIME };
  const zipped = zipSync({
    [basename(filePath)]: [content, entryOptions],
    [METADATA_FILENAME]: [strToU8(buildMetadataFile(plugin)), entryOptions],
  });
  return Buffer.from(zipped);
}

/** Deterministic STORE + fixed-mtime options for a normalized ZIP entry. */
const ENTRY_OPTIONS = { level: 0 as const, mtime: FIXED_MTIME };

/** `os` = 3 (Unix) — required for `attrs` to carry Unix mode bits in a ZIP. */
const ZIP_OS_UNIX = 3;

/**
 * Recursively find `.app` bundle directories under `dir` (does not descend into
 * a `.app` once found), mirroring the legacy CLI's `Products/**` + `*.app` glob.
 */
function findAppBundles(dir: string): string[] {
  const found: string[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const full = join(dir, dirent.name);
    if (dirent.name.endsWith(".app")) {
      found.push(full);
    } else {
      found.push(...findAppBundles(full));
    }
  }
  return found;
}

/**
 * Validate that a directory is a real XCArchive before it is zipped and
 * uploaded — mirrors the legacy CLI's `validate_xcarchive_directory`.
 *
 * Guards against accidentally uploading an arbitrary directory (e.g. a project
 * root, which would sweep up `.git/`, `node_modules/`, and `.env` secrets).
 * Requires a root `Info.plist`, a `Products/` directory, and at least one
 * `.app` bundle (each with its own `Info.plist`).
 *
 * @throws {ValidationError} If the directory is not a valid XCArchive.
 */
export function validateXcarchiveDirectory(dirPath: string): void {
  const root = resolve(dirPath);
  if (!existsSync(join(root, "Info.plist"))) {
    throw new ValidationError(
      "Invalid XCArchive: missing Info.plist at the archive root",
      "path"
    );
  }
  const products = join(root, "Products");
  if (!(existsSync(products) && statSync(products).isDirectory())) {
    throw new ValidationError(
      "Invalid XCArchive: missing Products/ directory",
      "path"
    );
  }
  const apps = findAppBundles(products);
  if (apps.length === 0) {
    throw new ValidationError(
      "Invalid XCArchive: no .app bundles found under Products/",
      "path"
    );
  }
  for (const app of apps) {
    if (!existsSync(join(app, "Info.plist"))) {
      throw new ValidationError(
        `Invalid XCArchive: missing Info.plist in .app bundle: ${basename(app)}`,
        "path"
      );
    }
  }
}

/** A collected archive entry: its relative path, bytes, and ZIP attrs. */
type ArchiveEntry = { relPath: string; content: Uint8Array; attrs: number };

/**
 * Recursively collect an XCArchive's entries, preserving symlinks and Unix
 * permissions (via ZIP external attributes) exactly as the legacy CLI does.
 *
 * A custom walk (rather than the shared file walker) is used because fidelity
 * matters here: symlinks are stored as symlink entries (their target string as
 * content, `S_IFLNK` in the mode) — NOT followed — so Apple framework/dSYM
 * bundles aren't restructured or their binaries duplicated, which would corrupt
 * the server's size analysis. Symlinked directories are recorded as links and
 * not descended into, matching the Rust `WalkDir` (follow_links = false).
 */
async function collectArchiveEntries(root: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];

  const walk = async (dir: string, prefix: string): Promise<void> => {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const full = join(dir, dirent.name);
      const relPath = prefix ? `${prefix}/${dirent.name}` : dirent.name;

      // Check symlink first: a symlink to a directory must be stored as a link,
      // not descended into (matching Rust's WalkDir with follow_links = false).
      let content: Uint8Array;
      if (dirent.isSymbolicLink()) {
        content = strToU8(await readlink(full));
      } else if (dirent.isDirectory()) {
        await walk(full, relPath);
        continue;
      } else if (dirent.isFile()) {
        content = await readFile(full);
      } else {
        // Skip sockets, FIFOs, and other special files.
        continue;
      }

      // Encode the full Unix mode (type + permission bits) into the upper 16
      // bits of the ZIP external attributes so symlinks and exec bits survive.
      const { mode } = await lstat(full);
      const attrs = ((mode & 0xff_ff) << 16) >>> 0;
      entries.push({ relPath, content, attrs });
    }
  };

  await walk(root, "");
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return entries;
}

/**
 * Wrap an XCArchive directory into a deterministic normalized ZIP for upload.
 *
 * Every file under `dirPath` is stored under `<dir-basename>/<relative-path>`
 * (STORE, fixed mtime, sorted for byte-stability) alongside a root
 * `.sentry-cli-metadata.txt`, mirroring the legacy CLI's `normalize_directory`.
 * Symlinks and Unix permissions are preserved (see {@link collectArchiveEntries});
 * validate the directory first with {@link validateXcarchiveDirectory}.
 *
 * Documented gap: `Assets.car` asset catalogs are not parsed into per-asset
 * images (that required native macOS frameworks), so no `ParsedAssets/` tree is
 * added — the raw `.car` is uploaded as-is.
 *
 * The whole directory is read into memory; a very large XCArchive (e.g. with
 * dSYMs) could exceed Node's ~2 GiB Buffer cap — streaming is a follow-up.
 *
 * @param dirPath - Path to the XCArchive directory.
 * @param plugin - Optional plugin identity for the metadata file.
 * @returns The normalized ZIP bytes.
 */
export async function normalizeBuildDirectory(
  dirPath: string,
  plugin: PipelinePlugin | null
): Promise<Buffer> {
  const root = resolve(dirPath);
  const dirName = basename(root);

  const entries: Zippable = {};
  for (const entry of await collectArchiveEntries(root)) {
    entries[`${dirName}/${entry.relPath}`] = [
      entry.content,
      { level: 0, mtime: FIXED_MTIME, os: ZIP_OS_UNIX, attrs: entry.attrs },
    ];
  }
  entries[METADATA_FILENAME] = [
    strToU8(buildMetadataFile(plugin)),
    ENTRY_OPTIONS,
  ];

  return Buffer.from(zipSync(entries));
}

/** Regex matching an IPA's single `Payload/<name>.app/Info.plist` entry. */
const IPA_APP_INFO_PLIST = /^Payload\/([^/]+)\.app\/Info\.plist$/;

/**
 * Extract the single app name from an IPA's entry names.
 *
 * @throws {Error} If the IPA does not contain exactly one `.app`.
 */
export function extractIpaAppName(names: string[]): string {
  const appNames = new Set<string>();
  for (const name of names) {
    const match = IPA_APP_INFO_PLIST.exec(name);
    if (match?.[1]) {
      appNames.add(match[1]);
    }
  }
  const appName = appNames.values().next().value;
  if (appNames.size !== 1 || appName === undefined) {
    throw new Error("IPA did not contain exactly one .app");
  }
  return appName;
}

/** Build the XCArchive `Info.plist` for a converted IPA. */
function xcarchiveInfoPlist(appName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ApplicationProperties</key>
	<dict>
		<key>ApplicationPath</key>
		<string>Applications/${appName}.app</string>
	</dict>
	<key>ArchiveVersion</key>
	<integer>1</integer>
</dict>
</plist>`;
}

/**
 * Convert an IPA into a deterministic normalized XCArchive ZIP for upload.
 *
 * The IPA (a ZIP of `Payload/<app>.app/…`) is remapped in-memory into an
 * XCArchive layout — `archive.xcarchive/Products/Applications/<app>.app/…` plus
 * a generated `archive.xcarchive/Info.plist` — and stored (STORE, fixed mtime)
 * alongside a root `.sentry-cli-metadata.txt`. Mirrors the legacy CLI's
 * `ipa_to_xcarchive` + `normalize_directory`.
 *
 * @param content - The raw IPA bytes.
 * @param plugin - Optional plugin identity for the metadata file.
 * @returns The normalized ZIP bytes.
 * @throws {Error} If the IPA does not contain exactly one `.app`.
 */
export function normalizeIpa(
  content: Uint8Array,
  plugin: PipelinePlugin | null
): Buffer {
  const ipaEntries = unzipSync(content);
  const appName = extractIpaAppName(Object.keys(ipaEntries));

  const archiveDir = "archive.xcarchive";
  // Only the identified app's entries are included (an IPA should contain
  // exactly one `.app`); a stray second bundle is ignored so it can't skew size
  // analysis.
  const appPrefix = `Payload/${appName}.app/`;

  // Collect (path, bytes) then sort so the output depends only on contents, not
  // on the IPA's central-directory order — keeping bytes deterministic for
  // chunk dedup across re-uploads (as normalizeBuildDirectory does).
  const archiveEntries: Array<[string, Uint8Array]> = [];
  for (const [name, bytes] of Object.entries(ipaEntries)) {
    // Directory entries (trailing "/") carry no data; skip them.
    if (name.endsWith("/") || !name.startsWith(appPrefix)) {
      continue;
    }
    const stripped = name.slice("Payload/".length);
    // Skip path-traversal entries (a `..` segment) defensively, matching the
    // legacy CLI's `enclosed_name()` guard.
    if (stripped.split("/").includes("..")) {
      continue;
    }
    archiveEntries.push([
      `${archiveDir}/Products/Applications/${stripped}`,
      bytes,
    ]);
  }
  archiveEntries.push([
    `${archiveDir}/Info.plist`,
    strToU8(xcarchiveInfoPlist(appName)),
  ]);
  archiveEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const entries: Zippable = {};
  for (const [key, bytes] of archiveEntries) {
    entries[key] = [bytes, ENTRY_OPTIONS];
  }
  entries[METADATA_FILENAME] = [
    strToU8(buildMetadataFile(plugin)),
    ENTRY_OPTIONS,
  ];

  return Buffer.from(zipSync(entries));
}
