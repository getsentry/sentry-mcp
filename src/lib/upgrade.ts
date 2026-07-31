/**
 * Upgrade Module
 *
 * Detects how the CLI was installed and provides self-upgrade functionality.
 * Binary management helpers (download URLs, locking, replacement) live in
 * binary.ts and are shared with the setup --install flow.
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  acquireLock,
  cleanupOldBinary,
  fetchWithUpgradeError,
  GITHUB_RELEASES_URL,
  getBinaryDownloadUrl,
  getBinaryFilename,
  getBinaryPaths,
  getGitHubHeaders,
  getPlatformBinaryName,
  type InstallationMethod,
  isNightlyVersion,
  KNOWN_CURL_DIRS,
  releaseLock,
} from "./binary.js";
import { CLI_VERSION, NODE_MODULES_DIRNAME } from "./constants.js";
import { getInstallInfo, setInstallInfo } from "./db/install-info.js";
import type { ReleaseChannel } from "./db/release-channel.js";
import { attemptDeltaUpgrade, type DeltaResult } from "./delta-upgrade.js";
import { AbortError, UpgradeError } from "./errors.js";
import { formatBytes } from "./formatters/numbers.js";
import {
  downloadNightlyBlob,
  fetchManifest,
  fetchNightlyManifest,
  findLayerByFilename,
  getAnonymousToken,
  getNightlyVersion,
} from "./ghcr.js";
import { logger } from "./logger.js";
import { clearPatchCache } from "./patch-cache.js";
import { makeByteProgress, type SetMessage } from "./progress.js";

/** Scoped logger for upgrade operations */
const log = logger.withTag("upgrade");

// Re-export for backward compatibility — consumers that import
// InstallationMethod from upgrade.ts continue to work.
export type { InstallationMethod } from "./binary.js";
// biome-ignore lint/performance/noBarrelFile: backward-compat re-export, not a barrel
export { parseInstallationMethod } from "./binary.js";

/** Package managers that can be used for global installs */
type PackageManager = "npm" | "pnpm" | "bun" | "yarn";

/**
 * How the current upgrade reached the offline code path.
 *
 * - `false` — online upgrade (network available)
 * - `"explicit"` — user passed `--offline` flag
 * - `"network-fallback"` — network failed, auto-fell back to cache
 */
export type OfflineMode = false | "explicit" | "network-fallback";

// Constants

/** The git tag used for the rolling nightly GitHub release (stable fallback only). */
export const NIGHTLY_TAG = "nightly";

/** npm registry base URL */
const NPM_REGISTRY_URL = "https://registry.npmjs.org/sentry";

/** Regex to strip 'v' prefix from version strings */
export const VERSION_PREFIX_REGEX = /^v/;

// Curl Binary Helpers

/**
 * Known directories where the curl installer may place the binary.
 * Resolved at runtime against the user's home directory.
 * Used for legacy detection (when no install info is stored).
 * Trailing separator ensures startsWith matches a directory boundary
 * (e.g. ~/.local/bin/ won't match ~/.local/binaries/).
 *
 * Computed lazily (not at module load) to avoid TDZ issues from circular
 * imports — `KNOWN_CURL_DIRS` must be fully initialized before access.
 */
let _knownCurlPaths: string[] | undefined;
function getKnownCurlPaths(): string[] {
  _knownCurlPaths ??= KNOWN_CURL_DIRS.map((dir) => join(homedir(), dir) + sep);
  return _knownCurlPaths;
}

/**
 * Get file paths for curl-installed binary.
 *
 * Priority for determining install path:
 * 1. Stored install path from DB (if method is curl AND its directory still
 *    exists — a stale path whose directory was purged is skipped)
 * 2. process.execPath if it's in a known curl install location
 * 3. Default to ~/.sentry/bin/sentry (fallback for fresh installs)
 *
 * @returns Object with install, temp, old, and lock file paths
 */
export function getCurlInstallPaths(): {
  installPath: string;
  tempPath: string;
  oldPath: string;
  lockPath: string;
} {
  // Check stored install path. Only trust it when its directory still exists:
  // a test install via SENTRY_INSTALL_DIR (e.g. /tmp/sentry-test-install) can
  // leave a DB row pointing at a directory that was later purged. Trusting it
  // blindly made the upgrade lock/install into a dead location, crashing with
  // `ENOENT ... open '.../sentry.lock'` (reported in #discuss-cli).
  //
  // existsSync also returns false on EACCES / a transiently-unmounted parent,
  // in which case we fall through to execPath / the ~/.sentry/bin fallback
  // rather than erroring. That tradeoff is acceptable: the running binary's
  // own directory (execPath) is by definition accessible, so a genuine install
  // is still found; only an unreadable *stored hint* is ignored.
  const stored = getInstallInfo();
  if (
    stored?.path &&
    stored.method === "curl" &&
    existsSync(dirname(stored.path))
  ) {
    return getBinaryPaths(stored.path);
  }

  // Check if we're running from a known curl install location
  for (const dir of getKnownCurlPaths()) {
    if (process.execPath.startsWith(dir)) {
      return getBinaryPaths(process.execPath);
    }
  }

  // Fallback to default path (for fresh installs or non-curl runs like tests)
  const defaultPath = join(homedir(), ".sentry", "bin", getBinaryFilename());
  return getBinaryPaths(defaultPath);
}

/**
 * Start cleanup of the .old binary for this install.
 * Called on CLI startup. Fire-and-forget, non-blocking.
 */
export function startCleanupOldBinary(): void {
  const { oldPath } = getCurlInstallPaths();
  cleanupOldBinary(oldPath);
}

// Detection

/**
 * Run a shell command and capture stdout.
 *
 * On Windows, package managers (npm, pnpm, yarn) are `.cmd` batch files.
 * `spawn()` without `shell: true` cannot execute `.cmd` files (ENOENT),
 * so we route through cmd.exe on Windows.
 *
 * @param command - Command to execute
 * @param args - Command arguments
 * @returns stdout content and exit code
 */
function runCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    // Drain stderr to prevent blocking (content is intentionally discarded)
    proc.stderr.resume();

    proc.on("close", (code) => {
      resolve({ stdout: stdout.trim(), exitCode: code ?? 1 });
    });

    proc.on("error", reject);
  });
}

/**
 * Check if a package is installed globally with a specific package manager.
 *
 * @param pm - Package manager to check
 * @returns true if sentry is installed globally via this package manager
 */
async function isInstalledWith(pm: PackageManager): Promise<boolean> {
  try {
    const args =
      pm === "yarn"
        ? ["global", "list", "--depth=0"]
        : ["list", "-g", "sentry"];

    const { stdout, exitCode } = await runCommand(pm, args);

    return exitCode === 0 && stdout.includes("sentry@");
  } catch {
    return false;
  }
}

/**
 * Detect if the CLI binary is running from a Homebrew Cellar.
 *
 * Homebrew places the real binary deep in the Cellar
 * (e.g. `/opt/homebrew/Cellar/sentry/1.2.3/bin/sentry`) and exposes it
 * via a symlink at the prefix bin dir (e.g. `/opt/homebrew/bin/sentry`).
 * `process.execPath` typically reflects the symlink, not the realpath, so
 * we resolve symlinks first before checking for `/Cellar/`. Falls back to
 * the unresolved path if `realpathSync` throws (e.g. binary was deleted).
 */
function isHomebrewInstall(): boolean {
  let execPath = process.execPath;
  try {
    execPath = realpathSync(execPath);
  } catch {
    // Binary may have been deleted or moved; use the original path
  }
  return execPath.includes("/Cellar/");
}

/**
 * Detect package manager from the script path in process.argv[1].
 *
 * When the CLI is installed via npm/pnpm/yarn/bun as a global package,
 * Node.js sets process.argv[1] to the script entry point inside
 * node_modules (e.g., ".../node_modules/sentry/dist/bin.cjs").
 * This is a fast, authoritative signal that avoids the slow and
 * fragile subprocess-based detection (which fails on Windows where
 * package manager executables are .cmd files not found by spawn()).
 *
 * pnpm is distinguished by its unique ".pnpm" directory inside node_modules.
 * bun global installs live under ~/.bun/ (detected via ".bun" segment).
 * All other node_modules layouts (npm, yarn) default to "npm".
 *
 * @returns Package manager name, or null if not running from node_modules
 */
export function detectPackageManagerFromPath(): PackageManager | null {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return null;
  }

  const segments = scriptPath.split(sep);
  if (!segments.includes(NODE_MODULES_DIRNAME)) {
    return null;
  }

  // pnpm uses a distinctive .pnpm directory inside node_modules
  if (segments.includes(".pnpm")) {
    return "pnpm";
  }

  // bun global installs live under ~/.bun/install/global/node_modules/
  if (segments.includes(".bun")) {
    return "bun";
  }

  // Default to npm for other node_modules installations (npm, yarn classic)
  return "npm";
}

/**
 * Legacy detection for existing installs that don't have stored install info.
 * Checks known curl install paths and package managers.
 *
 * @returns Detected installation method, or "unknown" if unable to determine
 */
async function detectLegacyInstallationMethod(): Promise<InstallationMethod> {
  // Check known curl install paths
  for (const dir of getKnownCurlPaths()) {
    if (process.execPath.startsWith(dir)) {
      return "curl";
    }
  }

  // Check package managers in order of popularity
  const packageManagers: PackageManager[] = ["npm", "pnpm", "bun", "yarn"];

  for (const pm of packageManagers) {
    if (await isInstalledWith(pm)) {
      return pm;
    }
  }

  // Fallback: if all subprocess calls failed (e.g. Windows ENOENT where
  // .cmd files aren't found by spawn()), detect from node_modules path.
  // Placed after subprocess calls so that yarn is correctly detected on
  // platforms where subprocess detection works (macOS/Linux).
  const pmFromPath = detectPackageManagerFromPath();
  if (pmFromPath) {
    return pmFromPath;
  }

  return "unknown";
}

/**
 * Detect how the CLI was installed.
 *
 * Priority:
 * 1. Homebrew — cheap realpath check, overrides stale stored info
 * 2. Stored install info in DB (fast path)
 * 3. Legacy detection: curl paths → subprocess calls → node_modules path
 * 4. Auto-save detected method for future runs
 *
 * @returns Detected installation method, or "unknown" if unable to determine
 */
export async function detectInstallationMethod(): Promise<InstallationMethod> {
  // Always check for Homebrew first — the stored install info may be stale
  // (e.g. user previously had a curl install recorded, then switched to
  // Homebrew). The realpath check is cheap and authoritative.
  if (isHomebrewInstall()) {
    return "brew";
  }

  // Check stored info (fast path for non-Homebrew installs)
  const stored = getInstallInfo();
  if (stored?.method) {
    return stored.method;
  }

  // Legacy detection for existing installs (pre-setup command)
  const legacyMethod = await detectLegacyInstallationMethod();

  // Auto-save detected method for future runs (best-effort —
  // a read-only or broken DB shouldn't block detection)
  if (legacyMethod !== "unknown") {
    try {
      setInstallInfo({
        method: legacyMethod,
        path: process.execPath,
        version: CLI_VERSION,
      });
    } catch {
      log.debug("Failed to persist install info (DB may be read-only)");
    }
  }

  return legacyMethod;
}

// Version Fetching

/**
 * Fetch the latest version from GitHub releases.
 *
 * @param signal - Optional AbortSignal to cancel the request
 * @returns Latest version string (without 'v' prefix)
 * @throws {UpgradeError} When fetch fails or response is invalid
 * @throws {Error} AbortError if signal is aborted
 */
export async function fetchLatestFromGitHub(
  signal?: AbortSignal
): Promise<string> {
  const response = await fetchWithUpgradeError(
    `${GITHUB_RELEASES_URL}/latest`,
    { headers: getGitHubHeaders(), signal },
    "GitHub"
  );

  if (!response.ok) {
    throw new UpgradeError(
      "network_error",
      `Failed to fetch from GitHub: ${response.status}`
    );
  }

  const data = (await response.json()) as { tag_name?: string };

  if (!data.tag_name) {
    throw new UpgradeError(
      "network_error",
      "No version found in GitHub release"
    );
  }

  return data.tag_name.replace(VERSION_PREFIX_REGEX, "");
}

/**
 * Fetch the latest version from npm registry.
 *
 * @returns Latest version string
 * @throws {UpgradeError} When fetch fails or response is invalid
 */
export async function fetchLatestFromNpm(): Promise<string> {
  const response = await fetchWithUpgradeError(
    `${NPM_REGISTRY_URL}/latest`,
    { headers: { Accept: "application/json" } },
    "npm registry"
  );

  if (!response.ok) {
    throw new UpgradeError(
      "network_error",
      `Failed to fetch from npm: ${response.status}`
    );
  }

  const data = (await response.json()) as { version?: string };

  if (!data.version) {
    throw new UpgradeError("network_error", "No version found in npm registry");
  }

  return data.version;
}

/**
 * Fetch the latest nightly version from GHCR.
 *
 * Performs an anonymous token exchange then fetches the OCI manifest for the
 * `:nightly` tag. The version is extracted from the manifest annotation —
 * only 2 HTTP requests total (token + manifest), no blob download needed.
 *
 * @param signal - Optional AbortSignal to cancel the requests
 * @returns Latest nightly version string (e.g., "0.13.0-dev.1740000000")
 * @throws {UpgradeError} When fetch fails or the version annotation is missing
 */
export async function fetchLatestNightlyVersion(
  signal?: AbortSignal
): Promise<string> {
  // AbortSignal is not threaded through ghcr helpers, but checking it before
  // each network call ensures we bail out promptly when the process exits.
  if (signal?.aborted) {
    throw new AbortError();
  }

  const token = await getAnonymousToken();

  if (signal?.aborted) {
    throw new AbortError();
  }

  const manifest = await fetchNightlyManifest(token);
  return getNightlyVersion(manifest);
}

/**
 * Fetch the latest available version based on installation method and channel.
 *
 * - nightly channel: fetches version from GHCR manifest annotation
 * - curl/brew on stable: checks GitHub /releases/latest
 * - package managers on stable: checks npm registry
 *
 * @param method - How the CLI was installed
 * @param channel - Release channel ("stable" or "nightly"), defaults to "stable"
 * @returns Latest version string (without 'v' prefix)
 * @throws {UpgradeError} When version fetch fails
 */
export function fetchLatestVersion(
  method: InstallationMethod,
  channel: ReleaseChannel = "stable"
): Promise<string> {
  if (channel === "nightly") {
    return fetchLatestNightlyVersion();
  }
  return method === "curl" || method === "brew"
    ? fetchLatestFromGitHub()
    : fetchLatestFromNpm();
}

/**
 * Check if a versioned nightly tag exists in GHCR.
 *
 * Nightly builds are published to GHCR with tags like `nightly-0.14.0-dev.1772661724`.
 * This performs an anonymous token exchange + manifest fetch (2 HTTP requests).
 * Returns false only for 404/403 (tag not found); network errors propagate as
 * UpgradeError to match stable version check behavior.
 *
 * @param version - Nightly version string (e.g., "0.14.0-dev.1772661724")
 * @returns true if the nightly tag exists in GHCR, false if not found
 * @throws {UpgradeError} On network failure or GHCR unavailability
 */
async function nightlyVersionExists(version: string): Promise<boolean> {
  const token = await getAnonymousToken();
  try {
    await fetchManifest(token, `nightly-${version}`);
    return true;
  } catch (error) {
    // 404 = tag doesn't exist; 403 = token lacks access to non-existent tag
    if (
      error instanceof UpgradeError &&
      (error.message.includes("HTTP 404") || error.message.includes("HTTP 403"))
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Check if a specific version exists in the appropriate registry.
 *
 * Nightly versions are checked against GHCR (where they are published as
 * versioned tags like `nightly-0.14.0-dev.1772661724`). Stable versions
 * are checked against GitHub Releases (curl/brew) or npm (package managers).
 *
 * @param method - How the CLI was installed
 * @param version - Version to check (without 'v' prefix)
 * @returns true if the version exists
 * @throws {UpgradeError} When unable to connect to registry
 */
export async function versionExists(
  method: InstallationMethod,
  version: string
): Promise<boolean> {
  // Nightly versions are published to GHCR, not GitHub Releases or npm
  if (isNightlyVersion(version)) {
    return nightlyVersionExists(version);
  }

  if (method === "curl" || method === "brew") {
    const response = await fetchWithUpgradeError(
      `${GITHUB_RELEASES_URL}/tags/${version}`,
      { method: "HEAD", headers: getGitHubHeaders() },
      "GitHub"
    );
    return response.ok;
  }

  const response = await fetchWithUpgradeError(
    `${NPM_REGISTRY_URL}/${version}`,
    { method: "HEAD" },
    "npm registry"
  );
  return response.ok;
}

// Upgrade Execution

/** Result from downloadBinaryToTemp — includes both the binary path and lock path */
export type DownloadResult = {
  /** Path to the downloaded temporary binary */
  tempBinaryPath: string;
  /** Path to the lock file held during download (caller must release after child exits) */
  lockPath: string;
  /** Size of delta patch in bytes, when delta upgrade was used instead of full download */
  patchBytes?: number;
};

/**
 * Stream a response body through a decompression transform and write to disk.
 *
 * Uses a manual `for await` loop with `Bun.file().writer()` instead of
 * `Bun.write(path, Response)` to work around a Bun event-loop bug where
 * streaming response bodies get GC'd before completing.
 * See: https://github.com/oven-sh/bun/issues/13237
 *
 * @param body - Readable stream from a fetch response
 * @param destPath - File path to write the decompressed output
 */
async function streamDecompressToFile(
  body: ReadableStream<Uint8Array>,
  destPath: string,
  setMessage?: SetMessage
): Promise<void> {
  const stream = body.pipeThrough(new DecompressionStream("gzip"));
  const writer = createWriteStream(destPath);
  // Indeterminate byte counter: the decompressed size isn't known ahead of
  // time (Content-Length covers only the compressed stream), so we show a live
  // byte count rather than a misleading fraction. Feeds the surrounding
  // spinner via setMessage — cosmetic, never aborts.
  const progress = makeByteProgress("Downloading", null, setMessage);
  // Capture write errors early — without a listener, Node crashes with
  // ERR_UNHANDLED_ERROR if a write fails (ENOSPC, EIO, etc.) during the loop.
  let writeError: Error | undefined;
  writer.on("error", (err) => {
    writeError ??= err;
  });

  // Track the original streaming error so a later writer.end() rejection can't
  // mask it: an exception thrown from a finally overwrites a pending try
  // exception. We rethrow the ORIGINAL error preferentially.
  let streamError: unknown;
  try {
    for await (const chunk of stream) {
      if (writeError) {
        break;
      }
      const ok = writer.write(chunk);
      progress.onProgress(chunk.byteLength);
      if (!(ok || writeError)) {
        // Race drain against error — an I/O failure (ENOSPC) while the
        // buffer is full would never emit 'drain', causing a hang.
        // Clean up the unused listener to avoid MaxListenersExceededWarning.
        await new Promise<void>((resolve) => {
          const onDrain = (): void => {
            writer.removeListener("error", onError);
            resolve();
          };
          const onError = (): void => {
            writer.removeListener("drain", onDrain);
            resolve();
          };
          writer.once("drain", onDrain);
          writer.once("error", onError);
        });
      }
    }
  } catch (err) {
    streamError = err;
  } finally {
    progress.done();
  }

  // Always flush/close the writer. If the stream already failed, surface THAT
  // error (the root cause) and demote any end() rejection to a debug log so it
  // can't mask the original.
  try {
    await new Promise<void>((resolve, reject) => {
      writer.end((err?: Error | null) => {
        const finalErr = err ?? writeError;
        if (finalErr) {
          reject(finalErr);
        } else {
          resolve();
        }
      });
    });
  } catch (endErr) {
    if (streamError === undefined) {
      throw endErr;
    }
    log.debug(`writer.end failed after a stream error: ${String(endErr)}`);
  }

  if (streamError !== undefined) {
    throw streamError;
  }
}

/**
 * Build the gzip filename for the current platform binary.
 *
 * Nightly builds are stored in GHCR as `sentry-<os>-<arch>.gz` (or
 * `sentry-windows-x64.exe.gz` on Windows). This filename is the
 * `org.opencontainers.image.title` annotation on the matching OCI layer.
 *
 * @returns Filename of the gzip-compressed binary for this platform
 */
function getNightlyGzFilename(): string {
  return `${getPlatformBinaryName()}.gz`;
}

/**
 * Download a nightly binary from GHCR and decompress it to `destPath`.
 *
 * Fetches an anonymous token, retrieves the OCI manifest, finds the layer
 * matching this platform's `.gz` filename, then downloads and decompresses
 * the blob in-stream.
 *
 * When `version` is provided, fetches the pinned versioned tag
 * (`nightly-{version}`). Otherwise fetches the rolling `:nightly` tag.
 *
 * @param destPath - File path to write the decompressed binary
 * @param version - Specific nightly version to download (omit for latest)
 * @throws {UpgradeError} When GHCR fetch or blob download fails
 */
async function downloadNightlyToPath(
  destPath: string,
  version?: string,
  setMessage?: SetMessage
): Promise<void> {
  const token = await getAnonymousToken();
  const manifest = version
    ? await fetchManifest(token, `nightly-${version}`)
    : await fetchNightlyManifest(token);
  const filename = getNightlyGzFilename();
  const layer = findLayerByFilename(manifest, filename);
  const response = await downloadNightlyBlob(token, layer.digest);

  if (!response.body) {
    throw new UpgradeError(
      "execution_failed",
      "GHCR blob response had no body"
    );
  }
  await streamDecompressToFile(response.body, destPath, setMessage);
}

/**
 * Download a stable binary from GitHub Releases and write it to `destPath`.
 *
 * Tries the gzip-compressed URL first (`{url}.gz`, ~37 MB vs ~99 MB),
 * falling back to the raw binary URL on any failure. The compressed
 * download is streamed through DecompressionStream for minimal memory usage.
 *
 * @param version - Stable version string (without 'v' prefix)
 * @param destPath - File path to write the binary (decompressed if gzip)
 * @throws {UpgradeError} When both download attempts fail
 */
async function downloadStableToPath(
  version: string,
  destPath: string,
  setMessage?: SetMessage
): Promise<void> {
  const url = getBinaryDownloadUrl(version);
  const headers = getGitHubHeaders();

  // Try gzip-compressed download first (~60% smaller)
  try {
    const gzResponse = await fetchWithUpgradeError(
      `${url}.gz`,
      { headers },
      "GitHub"
    );
    if (gzResponse.ok && gzResponse.body) {
      await streamDecompressToFile(gzResponse.body, destPath, setMessage);
      return;
    }
  } catch {
    // Fall through to raw download
  }

  // Fall back to raw (uncompressed) binary
  const response = await fetchWithUpgradeError(url, { headers }, "GitHub");

  if (!response.ok) {
    throw new UpgradeError(
      "execution_failed",
      `Failed to download binary: HTTP ${response.status}`
    );
  }

  // Fully consume the response body before writing to disk.
  // Bun.write(path, Response) with a large streaming body can exit the
  // process before the download completes (Bun event-loop bug).
  // See: https://github.com/oven-sh/bun/issues/13237
  const body = await response.arrayBuffer();
  await writeFile(destPath, new Uint8Array(body));
}

/**
 * Max probe attempts before giving up. Six probes run with five sleeps
 * in between, yielding ~3.1s total wall-clock budget (see backoff table
 * on {@link waitForBinaryVisible}).
 */
const VERIFY_MAX_ATTEMPTS = 6;

/** Base delay (ms) between verify attempts. Doubles each retry. */
const VERIFY_BASE_DELAY_MS = 100;

/**
 * Stat the downloaded file, tolerating absence.
 *
 * Returns the file size when the path is present, a regular file, and
 * has non-zero size. Returns `null` otherwise so the caller can poll.
 */
function probeBinaryFile(path: string): number | null {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats?.isFile() && stats.size > 0) {
    return stats.size;
  }
  return null;
}

/**
 * Wait for a freshly written binary to become visible by path.
 *
 * On Windows + Bun 1.3.9 (CLI-1D3), streaming writes via `Bun.file().writer()`
 * can return from `writer.end()` before the OS surfaces the file by path.
 * A subsequent `Bun.spawn` then fails with `Executable not found in $PATH`.
 * Polling with exponential backoff lets the transient visibility race
 * self-heal without prompting the user to manually retry.
 *
 * Backoff table (6 probes, 5 sleeps, cumulative worst case 3.1s):
 *
 * | Attempt | Probe at | Sleep after |
 * |---------|----------|-------------|
 * | 1       | 0 ms     | 100 ms      |
 * | 2       | 100 ms   | 200 ms      |
 * | 3       | 300 ms   | 400 ms      |
 * | 4       | 700 ms   | 800 ms      |
 * | 5       | 1500 ms  | 1600 ms     |
 * | 6       | 3100 ms  | —           |
 *
 * @param path - Absolute path to the downloaded binary
 * @returns Size of the verified file in bytes
 * @throws {UpgradeError} When the file never becomes visible or stays empty
 */
async function waitForBinaryVisible(path: string): Promise<number> {
  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
    const size = probeBinaryFile(path);
    if (size !== null) {
      if (attempt > 1) {
        log.debug(`Binary became visible after ${attempt} attempts`);
      }
      return size;
    }
    if (attempt === VERIFY_MAX_ATTEMPTS) {
      break;
    }
    const delay = VERIFY_BASE_DELAY_MS * 2 ** (attempt - 1);
    log.debug(
      `Downloaded binary not yet visible at ${path}, retrying in ${delay}ms (attempt ${attempt}/${VERIFY_MAX_ATTEMPTS})`
    );
    await setTimeout(delay);
  }
  throw new UpgradeError(
    "execution_failed",
    `Downloaded binary is missing or empty at ${path}. ` +
      "This is usually transient — rerun `sentry cli upgrade` to retry."
  );
}

/**
 * Download the new binary to a temporary path and return its location.
 * Used by the upgrade command to download before spawning setup --install.
 *
 * For **nightly** versions (detected via {@link isNightlyVersion}), downloads
 * from GHCR using the OCI blob download protocol via {@link downloadNightlyToPath}.
 *
 * For **stable** versions, downloads from GitHub Releases via
 * {@link downloadStableToPath}.
 *
 * The lock is held on success so concurrent upgrades are blocked during the
 * download→spawn→install pipeline. The caller MUST release the lock after the
 * child process exits (the child may use a different install directory and
 * therefore a different lock file, so it cannot reliably release this one).
 *
 * If the child resolves to the same install path, it takes over the lock via
 * process.ppid recognition in acquireLock — the parent's subsequent release
 * is then a harmless no-op.
 *
 * @param version - Target version to download (used for display and comparison)
 * @param downloadTag - Git tag to use in the download URL. Defaults to `version`.
 *   Pass `NIGHTLY_TAG` ("nightly") when installing from the rolling nightly release
 *   so the URL points to the prerelease assets regardless of the version string.
 * @returns The downloaded binary path and lock path to release
 * @throws {UpgradeError} When download fails
 */
export async function downloadBinaryToTemp(
  version: string,
  downloadTag?: string,
  offline?: OfflineMode,
  setMessage?: SetMessage
): Promise<DownloadResult> {
  const { tempPath, lockPath } = getCurlInstallPaths();

  acquireLock(lockPath);

  try {
    // Clean up any leftover temp file from interrupted download
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore if doesn't exist
    }

    // Try delta upgrade first — downloads tiny patches instead of full binary.
    // Falls back to full download on any failure (missing patches, hash mismatch, etc.)
    const deltaResult = await tryDeltaUpgrade(
      version,
      tempPath,
      !!offline,
      setMessage
    );
    let patchBytes: number | undefined;
    if (deltaResult) {
      patchBytes = deltaResult.patchBytes;
    } else if (offline) {
      throw new UpgradeError(
        "offline_cache_miss",
        offline === "explicit"
          ? `Cannot upgrade to ${version} in offline mode — no pre-downloaded update is available. ` +
              "Run `sentry cli upgrade` without `--offline` to download the update directly."
          : `Cannot upgrade to ${version} — the network is unavailable and no pre-downloaded update was found. ` +
              "Check your internet connection and try again."
      );
    } else {
      log.debug("Downloading full binary");
      await downloadFullBinary(version, downloadTag, tempPath, setMessage);
    }

    // Verify the download produced a real, non-empty file before the caller
    // spawns it. Seen on Windows + Bun 1.3.9 (CLI-1D3): streaming writes via
    // `Bun.file(path).writer()` can return without surfacing the file by
    // path, leaving `Bun.spawn` to fail with an opaque
    // `Executable not found in $PATH: "...sentry.exe.download"`. Poll with
    // exponential backoff so a transient filesystem-visibility race
    // self-heals without asking the user to rerun.
    const verifiedSize = await waitForBinaryVisible(tempPath);
    log.debug(`Binary verified (${formatBytes(verifiedSize)})`);

    // Clear consumed patch cache — patches for the old version are useless
    // after the binary has been updated (whether via delta or full download).
    clearPatchCache().catch(() => {
      /* best-effort — don't fail the upgrade if cache cleanup fails */
    });

    // Set executable permission (Unix only)
    if (process.platform !== "win32") {
      chmodSync(tempPath, 0o755);
    }

    return { tempBinaryPath: tempPath, lockPath, patchBytes };
  } catch (error) {
    releaseLock(lockPath);
    throw error;
  }
}

/**
 * Attempt delta upgrade using binary patches.
 *
 * Uses the currently running binary as the base for patching.
 * Returns null silently on any failure so the caller can fall back.
 *
 * @param version - Target version to upgrade to
 * @param destPath - Path to write the patched binary
 * @returns Delta result with SHA-256 and size info, or null if delta is unavailable
 */
async function tryDeltaUpgrade(
  version: string,
  destPath: string,
  offline?: boolean,
  setMessage?: SetMessage
): Promise<DeltaResult | null> {
  return await attemptDeltaUpgrade(
    version,
    process.execPath,
    destPath,
    offline,
    setMessage
  );
}

/**
 * Download the full binary (non-delta path).
 *
 * @param version - Target version
 * @param downloadTag - Git tag override for the download URL
 * @param destPath - Path to write the binary
 */
async function downloadFullBinary(
  version: string,
  downloadTag: string | undefined,
  destPath: string,
  setMessage?: SetMessage
): Promise<void> {
  if (isNightlyVersion(version)) {
    await downloadNightlyToPath(destPath, version, setMessage);
  } else {
    await downloadStableToPath(downloadTag ?? version, destPath, setMessage);
  }
}

/**
 * Execute upgrade via Homebrew.
 *
 * Runs `brew upgrade getsentry/tools/sentry` which fetches the latest
 * formula from the tap and installs the new version. The version argument
 * is intentionally ignored: Homebrew manages versioning through the formula
 * file in the tap and does not support pinning to an arbitrary release.
 *
 * @throws {UpgradeError} When brew upgrade fails
 */
function executeUpgradeHomebrew(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("brew", ["upgrade", "getsentry/tools/sentry"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new UpgradeError(
            "execution_failed",
            `brew upgrade failed with exit code ${code}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(
        new UpgradeError("execution_failed", `brew failed: ${err.message}`)
      );
    });
  });
}

/**
 * Execute upgrade via package manager global install.
 *
 * @param pm - Package manager to use
 * @param version - Target version to install
 * @throws {UpgradeError} When installation fails
 */
function executeUpgradePackageManager(
  pm: PackageManager,
  version: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args =
      pm === "yarn"
        ? ["global", "add", `sentry@${version}`]
        : ["install", "-g", `sentry@${version}`];

    // npm/pnpm/yarn are .cmd batch files on Windows; spawn() without
    // shell: true cannot execute .cmd files (ENOENT).
    const proc = spawn(pm, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new UpgradeError(
            "execution_failed",
            `${pm} install failed with exit code ${code}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(
        new UpgradeError("execution_failed", `${pm} failed: ${err.message}`)
      );
    });
  });
}

/**
 * Execute the upgrade using the appropriate method.
 *
 * For curl installs, downloads the new binary to a temp path and returns a
 * DownloadResult with the binary path and lock path. The caller should spawn
 * `setup --install` on the new binary, then release the lock.
 *
 * For package manager installs, runs the package manager's global install
 * command (which replaces the binary in-place). The caller should then
 * spawn `setup` on the new binary for completions/agent skills.
 *
 * @param method - How the CLI was installed
 * @param version - Target version to install (used for display)
 * @param downloadTag - Git tag to download from. Defaults to `version`.
 *   Pass `NIGHTLY_TAG` for nightly installs so the URL uses the "nightly" tag.
 * @returns Download result with paths (curl), or null (package manager)
 * @throws {UpgradeError} When method is unknown or installation fails
 */
// biome-ignore lint/nursery/useMaxParams: established 4-param shape; setMessage is a defaulted spinner-progress extension
export async function executeUpgrade(
  method: InstallationMethod,
  version: string,
  downloadTag?: string,
  offline?: OfflineMode,
  setMessage?: SetMessage
): Promise<DownloadResult | null> {
  switch (method) {
    case "curl":
      return downloadBinaryToTemp(version, downloadTag, offline, setMessage);
    case "brew":
      await executeUpgradeHomebrew();
      return null;
    case "npm":
    case "pnpm":
    case "bun":
    case "yarn":
      await executeUpgradePackageManager(method, version);
      return null;
    default:
      throw new UpgradeError("unknown_method");
  }
}
