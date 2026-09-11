/**
 * Builds the deterministic, project-scoped filesystem snapshot sent to the
 * remote workflow. Files are opened through the project-file boundary and
 * revalidated before their contents are trusted, so later AI discovery can
 * narrow this inventory but cannot expand access beyond the selected project.
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.js";
import { MAX_FILE_BYTES } from "./constants.js";
import {
  detectSentrySetup,
  type ExistingSentryEvidence,
} from "./tools/detect-sentry.js";
import { listDir } from "./tools/list-dir.js";
import {
  closeProjectFile,
  type OpenedProjectFile,
  openProjectFile,
  projectFileChanged,
} from "./tools/project-file.js";
import type { DirEntry } from "./types.js";

/**
 * Common config files that multiple init steps frequently inspect.
 */
const COMMON_CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  "Gemfile",
  "Gemfile.lock",
  "go.mod",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "pom.xml",
  "Cargo.toml",
  "pubspec.yaml",
  "mix.exs",
  "composer.json",
  "Podfile",
  "CMakeLists.txt",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.ts",
  "nuxt.config.js",
  "angular.json",
  "astro.config.mjs",
  "astro.config.ts",
  "svelte.config.js",
  "remix.config.js",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "metro.config.js",
  "app.json",
  "electron-builder.yml",
  "wrangler.toml",
  "wrangler.jsonc",
  "serverless.yml",
  "serverless.ts",
  "bunfig.toml",
  "manage.py",
  "app.py",
  "main.py",
  "artisan",
  "symfony.lock",
  "wp-config.php",
  "config/packages/sentry.yaml",
  "appsettings.json",
  "Program.cs",
  "Startup.cs",
  "app/build.gradle",
  "app/build.gradle.kts",
  "src/main/resources/application.properties",
  "src/main/resources/application.yml",
  "config/application.rb",
  "main.go",
  "sentry.client.config.ts",
  "sentry.client.config.js",
  "sentry.server.config.ts",
  "sentry.server.config.js",
  "sentry.edge.config.ts",
  "sentry.edge.config.js",
  "sentry.properties",
  "instrumentation.ts",
  "instrumentation.js",
] as const;

const MAX_PREREAD_TOTAL_BYTES = 512 * 1024;
const INITIAL_DIR_MAX_ENTRIES = 500;

const PROJECT_MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "requirements-dev.txt",
  "Pipfile",
  "deno.json",
  "deno.jsonc",
  "deps.ts",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "composer.json",
  "mix.exs",
  "rebar.config",
  "pubspec.yaml",
  "Package.swift",
  "Podfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "packages.config",
  "CMakeLists.txt",
  "Makefile",
  "meson.build",
]);
const PROJECT_MANIFEST_RE =
  /^(?:requirements.*\.txt)$|\.(?:csproj|fsproj|vbproj|sln|gemspec|rockspec)$/i;

const SDK_CONFIG_PATH_RE =
  /(?:^|\/)sentry(?:\.[^/]+)?\.config\.[^/]+$|(?:^|\/)config\/sentry\.php$/;

/** Deterministic project root containing strong local Sentry evidence. */
export type SentrySetupTarget = {
  /** Whether complete, untruncated evidence makes unattended selection safe. */
  autoSelect: boolean;
  /** Stable, non-empty repository-relative identifier. */
  name: string;
  /** Absolute filesystem path to the detected project root. */
  path: string;
};

/** Deterministic workspace surface shown in the monorepo target selector. */
export type WorkspaceTarget = {
  /** Framework proven by target-local config or scripts, when available. */
  framework?: string;
  /** Human-facing name enriched with repository context. */
  label: string;
  /** Stable CLI identifier used by `--app` and suspend/resume. */
  name: string;
  /** Absolute filesystem path to the workspace surface. */
  path: string;
  /** Product role inferred from workspace position, manifest, and local docs. */
  role: "application" | "documentation" | "example" | "runtime";
};

/** Deterministic workspace inventory plus whether it covers every project root. */
export type WorkspaceTargetInventory = {
  /** True only when every conventional workspace project can be classified. */
  complete: boolean;
  /** Targets proven locally and safe to use as the authoritative target set. */
  targets: WorkspaceTarget[];
};

type PackageManifest = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  exports?: unknown;
  name?: unknown;
  private?: unknown;
  publishConfig?: unknown;
  scripts?: Record<string, unknown>;
  workspaces?: unknown;
};

const WORKSPACE_PACKAGE_RE =
  /^(?:apps|packages|services|sites|websites)\/[^/]+\/package\.json$/;
const DIRECT_DEPLOYMENT_ROOT_RE = /^(?:apps|services|sites|websites)\//;
const EXAMPLE_NAME_RE =
  /(?:^|[-_.])(demo|example|playground|sandbox)(?:$|[-_.])/i;
const DOCS_NAME_RE = /(?:^|[-_.])(docs?|documentation|website)(?:$|[-_.])/i;
const REFERENCE_APP_RE =
  /\b(?:canonical\s+consumer|demo|example|reference)\s+(?:application|app)|\btest bed\b/i;
const DEVELOPMENT_PACKAGE_RE =
  /(?:^|[-_.])(evals?|fixtures?|tests?|testing)(?:$|[-_.])/i;
const SUPPORTED_WORKSPACE_GLOB_RE =
  /^(?:apps|packages|services|sites|websites)\/\*$/;
const YAML_LIST_ITEM_RE = /^\s+-\s+["']?([^"'#\s]+)["']?\s*(?:#.*)?$/;
const LEADING_WHITESPACE_RE = /^\s/;
const REPO_SUFFIX_RE = /[-_.](?:monorepo|repo|workspace)$/i;
const NAME_SEPARATOR_RE = /[-_.]+/;

const FRAMEWORK_CONFIGS = [
  ["astro.config.", "Astro"],
  ["nitro.config.", "Nitro"],
  ["next.config.", "Next.js"],
  ["nuxt.config.", "Nuxt"],
  ["svelte.config.", "SvelteKit"],
  ["remix.config.", "Remix"],
] as const;
const FRAMEWORK_SCRIPTS = [
  [/\bastro\s+(?:build|dev|preview)\b/i, "Astro"],
  [/\bnitro\s+(?:build|dev|preview)\b/i, "Nitro"],
  [/\bnext\s+(?:build|dev|start)\b/i, "Next.js"],
  [/\bnuxt\s+(?:build|dev|generate|preview)\b/i, "Nuxt"],
  [/\bsvelte-kit\s+(?:build|dev|preview)\b/i, "SvelteKit"],
  [/\bremix\s+(?:build|dev)\b/i, "Remix"],
] as const;

/**
 * Pre-compute the initial directory listing before the first workflow call.
 */
export async function precomputeDirListing(
  directory: string
): Promise<DirEntry[]> {
  const result = await listDir({
    type: "tool",
    operation: "list-dir",
    cwd: directory,
    params: {
      path: ".",
      recursive: true,
      maxDepth: 3,
      maxEntries: INITIAL_DIR_MAX_ENTRIES,
    },
  });
  return (result.data as { entries?: DirEntry[] } | undefined)?.entries ?? [];
}

/**
 * Pre-read common config files to avoid repeated suspend/resume round-trips.
 */
export async function preReadCommonFiles(
  directory: string,
  dirListing: DirEntry[]
): Promise<Record<string, string | null>> {
  // `listDir` emits POSIX-normalized paths regardless of host OS,
  // so `COMMON_CONFIG_FILES` (POSIX) membership checks don't need
  // any per-path separator translation.
  const listingPaths = new Set(dirListing.map((entry) => entry.path));
  const toRead = COMMON_CONFIG_FILES.filter((filePath) =>
    listingPaths.has(filePath)
  );

  const cache: Record<string, string | null> = {};
  let totalBytes = 0;

  for (const filePath of toRead) {
    if (totalBytes >= MAX_PREREAD_TOTAL_BYTES) {
      break;
    }
    const result = await readCommonConfigFile(directory, filePath);
    if (result.status === "unreadable") {
      cache[filePath] = null;
      continue;
    }
    if (
      result.status === "read" &&
      totalBytes + result.bytes <= MAX_PREREAD_TOTAL_BYTES
    ) {
      cache[filePath] = result.content;
      totalBytes += result.bytes;
    }
  }

  return cache;
}

type CommonConfigRead =
  | { status: "skipped" | "unreadable" }
  | { bytes: number; content: string; status: "read" };

async function readCommonConfigFile(
  directory: string,
  filePath: string
): Promise<CommonConfigRead> {
  let opened: OpenedProjectFile | undefined;
  // biome-ignore lint/plugin: grandfathered silent catch — see #1531; drain by adding log.debug()/log.warn() or re-throwing.
  try {
    const result = await openProjectFile(directory, filePath);
    if ("error" in result) {
      return { status: "unreadable" };
    }
    opened = result;
    if (opened.stat.size > MAX_FILE_BYTES) {
      return { status: "skipped" };
    }

    const buffer = Buffer.alloc(opened.stat.size);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const readResult = await opened.handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead
      );
      if (readResult.bytesRead === 0) {
        return { status: "unreadable" };
      }
      bytesRead += readResult.bytesRead;
    }
    if (projectFileChanged(opened.stat, await opened.handle.stat())) {
      return { status: "unreadable" };
    }
    return {
      bytes: bytesRead,
      content: buffer.subarray(0, bytesRead).toString("utf-8"),
      status: "read",
    };
  } catch {
    return { status: "unreadable" };
  } finally {
    if (opened) {
      await closeProjectFile(opened.handle);
    }
  }
}

/**
 * Locate concrete project/workspace roots that already contain a strong
 * Sentry setup signal. These are discovery hints only: the selected target is
 * scanned again later, so root evidence can never become another app's status.
 */
export async function precomputeSentrySetupTargets(
  directory: string
): Promise<SentrySetupTarget[]> {
  const root = path.resolve(directory);
  const detection = await detectSentrySetup(directory);
  if (detection.status !== "installed") {
    return [];
  }

  const roots = new Set<string>();
  for (const evidence of detection.evidence ?? []) {
    const signalPath = strongEvidencePath(evidence);
    if (!signalPath) {
      continue;
    }
    const projectRoot = await findNearestProjectRoot(directory, signalPath);
    if (projectRoot) {
      roots.add(projectRoot);
    }
  }

  return await Promise.all(
    [...roots].sort().map((projectRoot) => ({
      autoSelect: detection.evidenceTruncated !== true,
      name: workspaceTargetId(root, projectRoot),
      path: projectRoot,
    }))
  );
}

/**
 * Inventory concrete JavaScript workspace targets before AI analysis so model
 * output can enrich, but never omit, applications and relevant packages.
 */
export async function precomputeWorkspaceTargetInventory(
  directory: string,
  dirListing: DirEntry[],
  sentrySetupTargets: SentrySetupTarget[]
): Promise<WorkspaceTargetInventory> {
  const root = path.resolve(directory);
  const listingPaths = new Set(
    dirListing
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.path)
  );
  const candidateRoots = workspaceCandidateRoots(
    root,
    listingPaths,
    sentrySetupTargets
  );
  const rootManifest = await readPackageManifest(root, root);
  const repoName = cleanRepoName(
    packageName(rootManifest) ?? path.basename(root)
  );
  const setupPaths = new Set(
    sentrySetupTargets.map((target) => path.resolve(target.path))
  );
  const targets: WorkspaceTarget[] = [];
  let complete =
    dirListing.length < INITIAL_DIR_MAX_ENTRIES &&
    (await hasSupportedWorkspaceDeclaration(
      root,
      rootManifest,
      listingPaths
    )) &&
    hasCompleteWorkspaceCoverage(root, listingPaths, candidateRoots);

  for (const projectRoot of [...candidateRoots].sort()) {
    const inspection = await inspectWorkspaceCandidate({
      listingPaths,
      projectRoot,
      repoName,
      root,
      setupPaths,
    });
    complete = complete && inspection.classified;
    if (inspection.target) {
      targets.push(inspection.target);
    }
  }

  return { complete, targets };
}

async function hasSupportedWorkspaceDeclaration(
  root: string,
  rootManifest: PackageManifest | undefined,
  listingPaths: Set<string>
): Promise<boolean> {
  if (listingPaths.has("pnpm-workspace.yaml")) {
    const workspacePath = path.join(root, "pnpm-workspace.yaml");
    if (!(await isSafeRegularFile(root, workspacePath))) {
      return false;
    }
    try {
      const contents = await fs.promises.readFile(workspacePath, "utf-8");
      return areSupportedWorkspacePatterns(pnpmWorkspacePatterns(contents));
    } catch (error) {
      logger.debug(
        `Failed to read workspace declaration: ${workspacePath}`,
        error
      );
      return false;
    }
  }
  return areSupportedWorkspacePatterns(
    manifestWorkspacePatterns(rootManifest?.workspaces)
  );
}

function pnpmWorkspacePatterns(contents: string): string[] {
  const patterns: string[] = [];
  let readingPackages = false;
  for (const line of contents.split("\n")) {
    if (line.trim() === "packages:") {
      readingPackages = true;
      continue;
    }
    if (
      readingPackages &&
      line.length > 0 &&
      !LEADING_WHITESPACE_RE.test(line)
    ) {
      break;
    }
    const pattern = readingPackages
      ? YAML_LIST_ITEM_RE.exec(line)?.[1]
      : undefined;
    if (pattern) {
      patterns.push(pattern);
    }
  }
  return patterns;
}

function manifestWorkspacePatterns(workspaces: unknown): string[] {
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (value): value is string => typeof value === "string"
    );
  }
  if (typeof workspaces !== "object" || workspaces === null) {
    return [];
  }
  const packages = (workspaces as { packages?: unknown }).packages;
  return Array.isArray(packages)
    ? packages.filter((value): value is string => typeof value === "string")
    : [];
}

function areSupportedWorkspacePatterns(patterns: string[]): boolean {
  return (
    patterns.length > 0 &&
    patterns.every((pattern) => SUPPORTED_WORKSPACE_GLOB_RE.test(pattern))
  );
}

function workspaceCandidateRoots(
  root: string,
  listingPaths: Set<string>,
  sentrySetupTargets: SentrySetupTarget[]
): Set<string> {
  const roots = new Set(
    [...listingPaths]
      .filter((filePath) => WORKSPACE_PACKAGE_RE.test(filePath))
      .map((filePath) => path.resolve(root, path.dirname(filePath)))
  );
  for (const target of sentrySetupTargets) {
    roots.add(path.resolve(target.path));
  }
  return roots;
}

function hasCompleteWorkspaceCoverage(
  root: string,
  listingPaths: Set<string>,
  candidateRoots: Set<string>
): boolean {
  return [...listingPaths].every((filePath) => {
    if (!isProjectManifestName(path.basename(filePath))) {
      return true;
    }
    const relativeProjectRoot = path.dirname(filePath);
    if (relativeProjectRoot === ".") {
      return true;
    }
    return candidateRoots.has(path.resolve(root, relativeProjectRoot));
  });
}

async function inspectWorkspaceCandidate({
  listingPaths,
  projectRoot,
  repoName,
  root,
  setupPaths,
}: {
  listingPaths: Set<string>;
  projectRoot: string;
  repoName: string;
  root: string;
  setupPaths: Set<string>;
}): Promise<{ classified: boolean; target?: WorkspaceTarget }> {
  const manifest = await readPackageManifest(root, projectRoot);
  if (!manifest) {
    return { classified: false };
  }
  const relativeRoot = path.relative(root, projectRoot).replaceAll("\\", "/");
  if (relativeRoot.startsWith("../") || path.isAbsolute(relativeRoot)) {
    return { classified: false };
  }

  const framework = detectWorkspaceFramework(
    relativeRoot,
    manifest,
    listingPaths
  );
  const hasSentrySetup = setupPaths.has(projectRoot);
  if (
    !isWorkspaceTarget({
      framework,
      hasSentrySetup,
      listingPaths,
      manifest,
      relativeRoot,
    })
  ) {
    return {
      classified: isKnownWorkspacePackage(relativeRoot, manifest),
    };
  }

  const rawName = packageName(manifest) ?? path.basename(projectRoot);
  const role = classifyWorkspaceRole({
    hasSentrySetup,
    manifest,
    rawName,
    readme: await readProjectReadme(root, projectRoot),
    relativeRoot,
  });
  return {
    classified: true,
    target: {
      ...(framework ? { framework } : {}),
      label: workspaceLabel(rawName, repoName, role),
      name: workspaceTargetId(root, projectRoot),
      path: projectRoot,
      role,
    },
  };
}

function isWorkspaceTarget({
  framework,
  hasSentrySetup,
  listingPaths,
  manifest,
  relativeRoot,
}: {
  framework: string | undefined;
  hasSentrySetup: boolean;
  listingPaths: Set<string>;
  manifest: PackageManifest;
  relativeRoot: string;
}): boolean {
  const hasDeployment =
    Boolean(framework) ||
    hasDeploymentIndicator(relativeRoot, manifest, listingPaths);
  return (
    DIRECT_DEPLOYMENT_ROOT_RE.test(relativeRoot) ||
    hasSentrySetup ||
    (hasDeployment && manifest.exports === undefined)
  );
}

function isKnownWorkspacePackage(
  relativeRoot: string,
  manifest: PackageManifest
): boolean {
  return (
    manifest.exports !== undefined ||
    manifest.private === false ||
    manifest.publishConfig !== undefined ||
    DEVELOPMENT_PACKAGE_RE.test(
      `${packageName(manifest) ?? ""} ${relativeRoot}`
    )
  );
}

function isProjectManifestName(name: string): boolean {
  return PROJECT_MANIFESTS.has(name) || PROJECT_MANIFEST_RE.test(name);
}

function hasDeploymentIndicator(
  relativeRoot: string,
  manifest: PackageManifest,
  listingPaths: Set<string>
): boolean {
  const prefix = relativeRoot ? `${relativeRoot}/` : "";
  if (
    ["Dockerfile", "vercel.json", "wrangler.toml", "wrangler.jsonc"].some(
      (fileName) => listingPaths.has(`${prefix}${fileName}`)
    )
  ) {
    return true;
  }
  return ["deploy", "start"].some(
    (script) => typeof manifest.scripts?.[script] === "string"
  );
}

function classifyWorkspaceRole({
  hasSentrySetup,
  manifest,
  rawName,
  readme,
  relativeRoot,
}: {
  hasSentrySetup: boolean;
  manifest: PackageManifest;
  rawName: string;
  readme: string;
  relativeRoot: string;
}): WorkspaceTarget["role"] {
  const identity = `${rawName} ${relativeRoot}`;
  if (EXAMPLE_NAME_RE.test(identity) || REFERENCE_APP_RE.test(readme)) {
    return "example";
  }
  if (
    DOCS_NAME_RE.test(identity) ||
    hasDependency(manifest, "@astrojs/starlight")
  ) {
    return "documentation";
  }
  if (hasSentrySetup && manifest.exports) {
    return "runtime";
  }
  return "application";
}

function detectWorkspaceFramework(
  relativeRoot: string,
  manifest: PackageManifest,
  listingPaths: Set<string>
): string | undefined {
  const prefix = relativeRoot ? `${relativeRoot}/` : "";
  for (const [configPrefix, framework] of FRAMEWORK_CONFIGS) {
    if (
      [...listingPaths].some(
        (filePath) =>
          filePath.startsWith(`${prefix}${configPrefix}`) &&
          !filePath.slice(prefix.length + configPrefix.length).includes("/")
      )
    ) {
      return framework;
    }
  }
  const scripts = Object.values(manifest.scripts ?? {})
    .filter((script): script is string => typeof script === "string")
    .join("\n");
  for (const [pattern, framework] of FRAMEWORK_SCRIPTS) {
    if (pattern.test(scripts)) {
      return framework;
    }
  }
  return;
}

function hasDependency(manifest: PackageManifest, name: string): boolean {
  return Boolean(
    manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]
  );
}

function packageName(
  manifest: PackageManifest | undefined
): string | undefined {
  return typeof manifest?.name === "string" && manifest.name.trim()
    ? manifest.name.trim()
    : undefined;
}

function cleanRepoName(name: string): string {
  return packageTail(name).replace(REPO_SUFFIX_RE, "");
}

function packageTail(name: string): string {
  return name.split("/").at(-1) ?? name;
}

function titleCase(name: string): string {
  return packageTail(name)
    .split(NAME_SEPARATOR_RE)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function workspaceLabel(
  packageNameValue: string,
  repoName: string,
  role: WorkspaceTarget["role"]
): string {
  const packageLabel = titleCase(packageNameValue);
  const repoLabel = titleCase(repoName);
  if (
    role !== "runtime" &&
    !packageLabel.toLowerCase().includes(repoLabel.toLowerCase())
  ) {
    return `${repoLabel} ${packageLabel}`;
  }
  return packageLabel;
}

async function readPackageManifest(
  root: string,
  projectRoot: string
): Promise<PackageManifest | undefined> {
  const packagePath = path.join(projectRoot, "package.json");
  if (!(await isSafeRegularFile(root, packagePath))) {
    return;
  }
  try {
    return JSON.parse(
      await fs.promises.readFile(packagePath, "utf-8")
    ) as PackageManifest;
  } catch (error) {
    logger.debug(`Failed to read workspace manifest: ${packagePath}`, error);
    return;
  }
}

async function readProjectReadme(
  root: string,
  projectRoot: string
): Promise<string> {
  for (const name of ["README.md", "README.mdx", "README.txt"]) {
    const readmePath = path.join(projectRoot, name);
    if (!(await isSafeRegularFile(root, readmePath))) {
      continue;
    }
    try {
      return (await fs.promises.readFile(readmePath, "utf-8")).slice(0, 16_384);
    } catch (error) {
      logger.debug(`Failed to read workspace README: ${readmePath}`, error);
      return "";
    }
  }
  return "";
}

async function isSafeRegularFile(
  root: string,
  candidate: string
): Promise<boolean> {
  try {
    const stat = await fs.promises.lstat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    const [realRoot, realCandidate] = await Promise.all([
      fs.promises.realpath(root),
      fs.promises.realpath(candidate),
    ]);
    return isPathWithin(realRoot, realCandidate);
  } catch (error) {
    logger.debug(`Workspace file is unavailable: ${candidate}`, error);
    return false;
  }
}

function strongEvidencePath(
  evidence: ExistingSentryEvidence
): string | undefined {
  if (evidence.kind === "initialization" || evidence.kind === "dsn") {
    return evidence.path;
  }
  if (evidence.kind === "config" && SDK_CONFIG_PATH_RE.test(evidence.path)) {
    return evidence.path;
  }
  return;
}

async function findNearestProjectRoot(
  directory: string,
  signalPath: string
): Promise<string | undefined> {
  const root = path.resolve(directory);
  const absoluteSignal = path.resolve(root, signalPath);
  if (
    absoluteSignal !== root &&
    !absoluteSignal.startsWith(`${root}${path.sep}`)
  ) {
    return;
  }

  const [realRoot, realSignal] = await Promise.all([
    tryRealpath(root),
    tryRealpath(absoluteSignal),
  ]);
  if (!(realRoot && realSignal && isPathWithin(realRoot, realSignal))) {
    return;
  }

  let current = path.dirname(absoluteSignal);
  while (current === root || current.startsWith(`${root}${path.sep}`)) {
    const realCurrent = await tryRealpath(current);
    if (
      realCurrent &&
      isPathWithin(realRoot, realCurrent) &&
      (await hasProjectManifest(current))
    ) {
      return current;
    }
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }
  return;
}

function isPathWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function workspaceTargetId(root: string, projectRoot: string): string {
  const relative = path.relative(root, projectRoot).replaceAll("\\", "/");
  return relative || ".";
}

async function tryRealpath(candidate: string): Promise<string | undefined> {
  try {
    return await fs.promises.realpath(candidate);
  } catch (error) {
    logger.debug(`Failed to resolve workspace path: ${candidate}`, error);
    return;
  }
}

async function hasProjectManifest(directory: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(directory, {
      withFileTypes: true,
    });
    return entries.some(
      (entry) =>
        entry.isFile() &&
        (PROJECT_MANIFESTS.has(entry.name) ||
          PROJECT_MANIFEST_RE.test(entry.name))
    );
  } catch (error) {
    logger.debug(`Failed to inspect project manifests: ${directory}`, error);
    return false;
  }
}
