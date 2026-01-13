/**
 * DSN Detector
 *
 * Automatically detects Sentry DSN from various sources:
 * 1. Environment variable (SENTRY_DSN)
 * 2. .env files in the current directory
 * 3. Code analysis using regex patterns (Sentry.init patterns)
 *
 * Uses Bun file APIs and Bun.Glob for file operations.
 */

import { join } from "node:path";
import type { DetectedDsn, DsnSource } from "../types/index.js";
import { parseDsn } from "./dsn.js";

/**
 * Environment variable name for Sentry DSN
 */
const SENTRY_DSN_ENV = "SENTRY_DSN";

/**
 * .env file names to search (in priority order)
 */
const ENV_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env",
  ".env.development",
  ".env.production",
];

/**
 * Glob pattern for source files to search
 */
const CODE_GLOB = new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}");

/**
 * Directories to skip when searching for source files
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
]);

/**
 * Regex patterns for extracting DSN from code (defined at top level for performance)
 */
const DSN_PATTERN_INIT =
  /Sentry\.init\s*\(\s*\{[^}]*dsn\s*:\s*["'`]([^"'`]+)["'`]/s;
const DSN_PATTERN_GENERIC = /dsn\s*:\s*["'`](https?:\/\/[^"'`]+@[^"'`]+)["'`]/s;
const ENV_FILE_PATTERN = /^SENTRY_DSN\s*=\s*(['"]?)(.+?)\1\s*(?:#.*)?$/;

/**
 * Create a DetectedDsn from a raw DSN string
 */
function createDetectedDsn(
  raw: string,
  source: DsnSource,
  sourcePath?: string
): DetectedDsn | null {
  const parsed = parseDsn(raw);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    raw,
    source,
    sourcePath,
  };
}

/**
 * Detect DSN from environment variable
 */
function detectFromEnv(): DetectedDsn | null {
  const dsn = process.env[SENTRY_DSN_ENV];
  if (!dsn) {
    return null;
  }

  return createDetectedDsn(dsn, "env");
}

/**
 * Parse a .env file and extract SENTRY_DSN value
 */
function parseEnvFile(content: string): string | null {
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Match SENTRY_DSN=value or SENTRY_DSN="value" or SENTRY_DSN='value'
    const match = trimmed.match(ENV_FILE_PATTERN);
    if (match?.[2]) {
      return match[2];
    }
  }

  return null;
}

/**
 * Detect DSN from .env files in the given directory
 */
async function detectFromEnvFiles(cwd: string): Promise<DetectedDsn | null> {
  for (const filename of ENV_FILES) {
    const filepath = join(cwd, filename);
    const file = Bun.file(filepath);

    if (!(await file.exists())) {
      continue;
    }

    try {
      const content = await file.text();
      const dsn = parseEnvFile(content);

      if (dsn) {
        return createDetectedDsn(dsn, "env_file", filepath);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return null;
}

/**
 * Extract DSN string from Sentry.init code using regex
 */
function extractDsnFromCode(content: string): string | null {
  // Try Sentry.init pattern first
  const initMatch = content.match(DSN_PATTERN_INIT);
  if (initMatch?.[1]) {
    return initMatch[1];
  }

  // Try generic dsn: "..." pattern
  const genericMatch = content.match(DSN_PATTERN_GENERIC);
  if (genericMatch?.[1]) {
    return genericMatch[1];
  }

  return null;
}

/**
 * Check if a path should be skipped
 */
function shouldSkipPath(filepath: string): boolean {
  const parts = filepath.split("/");
  return parts.some((part) => SKIP_DIRS.has(part));
}

/**
 * Detect DSN from source code using Bun.Glob
 */
async function detectFromCode(cwd: string): Promise<DetectedDsn | null> {
  for await (const relativePath of CODE_GLOB.scan({ cwd, onlyFiles: true })) {
    // Skip node_modules and other non-source directories
    if (shouldSkipPath(relativePath)) {
      continue;
    }

    const filepath = join(cwd, relativePath);
    const file = Bun.file(filepath);

    try {
      const content = await file.text();
      const dsn = extractDsnFromCode(content);

      if (dsn) {
        return createDetectedDsn(dsn, "code", filepath);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return null;
}

/**
 * Detect Sentry DSN from the current working directory
 *
 * Searches in priority order:
 * 1. SENTRY_DSN environment variable
 * 2. .env files (.env.local, .env, etc.)
 * 3. Source code (Sentry.init patterns)
 *
 * @param cwd - Directory to search in
 * @returns Detected DSN with source information, or null if not found
 *
 * @example
 * const dsn = await detectDsn(process.cwd());
 * if (dsn) {
 *   console.log(`Found DSN from ${dsn.source}: org ${dsn.orgId}, project ${dsn.projectId}`);
 * }
 */
export async function detectDsn(cwd: string): Promise<DetectedDsn | null> {
  // 1. Check environment variable first (highest priority)
  const envDsn = detectFromEnv();
  if (envDsn) {
    return envDsn;
  }

  // 2. Check .env files
  const envFileDsn = await detectFromEnvFiles(cwd);
  if (envFileDsn) {
    return envFileDsn;
  }

  // 3. Search source code
  const codeDsn = await detectFromCode(cwd);
  if (codeDsn) {
    return codeDsn;
  }

  return null;
}

/**
 * Get a human-readable description of the DSN source
 */
export function getDsnSourceDescription(dsn: DetectedDsn): string {
  switch (dsn.source) {
    case "env":
      return "SENTRY_DSN environment variable";
    case "env_file":
      return dsn.sourcePath ?? ".env file";
    case "code":
      return dsn.sourcePath ?? "source code";
    default:
      return "unknown source";
  }
}
