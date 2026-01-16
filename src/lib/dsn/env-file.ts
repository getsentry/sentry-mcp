/**
 * Environment File Detection
 *
 * Detects DSN from .env files in the project directory.
 * Supports various .env file variants in priority order.
 */

import { join } from "node:path";
import { createDetectedDsn } from "./parser.js";
import type { DetectedDsn } from "./types.js";

/**
 * .env file names to search (in priority order)
 *
 * More specific files (.env.local, .env.development.local) are checked first
 * as they typically contain environment-specific overrides.
 */
export const ENV_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env",
  ".env.development",
  ".env.production",
];

/**
 * Pattern to match SENTRY_DSN in .env files.
 * Handles: SENTRY_DSN=value, SENTRY_DSN="value", SENTRY_DSN='value'
 * Also handles trailing comments: SENTRY_DSN=value # comment
 */
const ENV_FILE_PATTERN = /^SENTRY_DSN\s*=\s*(['"]?)(.+?)\1\s*(?:#.*)?$/;

/**
 * Parse a .env file and extract SENTRY_DSN value
 *
 * @param content - File content
 * @returns DSN string or null if not found
 */
export function parseEnvFile(content: string): string | null {
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
 *
 * Searches files in priority order and returns the first valid DSN found.
 *
 * @param cwd - Directory to search in
 * @returns First detected DSN or null if not found
 */
export async function detectFromEnvFiles(
  cwd: string
): Promise<DetectedDsn | null> {
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
        return createDetectedDsn(dsn, "env_file", filename);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return null;
}

/**
 * Detect DSN from ALL .env files (for conflict detection)
 *
 * Unlike detectFromEnvFiles, this doesn't stop at the first match.
 * Used to find all DSNs when checking for conflicts.
 *
 * @param cwd - Directory to search in
 * @returns Array of all detected DSNs
 */
export async function detectFromAllEnvFiles(
  cwd: string
): Promise<DetectedDsn[]> {
  const results: DetectedDsn[] = [];

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
        const detected = createDetectedDsn(dsn, "env_file", filename);
        if (detected) {
          results.push(detected);
        }
      }
    } catch {
      // Skip files we can't read
    }
  }

  return results;
}

/**
 * Extract DSN from a specific .env file content
 *
 * Used by cache verification to check a specific file without scanning all.
 *
 * @param content - File content
 * @returns DSN string or null if not found
 */
export function extractDsnFromEnvFile(content: string): string | null {
  return parseEnvFile(content);
}
