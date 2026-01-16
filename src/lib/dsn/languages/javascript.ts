/**
 * JavaScript/TypeScript DSN Detection
 *
 * Detects DSN from JavaScript and TypeScript source code patterns.
 * Looks for Sentry.init({ dsn: "..." }) and similar patterns.
 */

import { join } from "node:path";
import { createDetectedDsn } from "../parser.js";
import type { DetectedDsn } from "../types.js";

/**
 * Glob pattern for JavaScript/TypeScript source files
 */
export const CODE_GLOB = new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}");

/**
 * Directories to skip when searching for source files
 * These are typically dependencies or build outputs
 */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".turbo",
  ".cache",
  ".vercel",
  ".netlify",
]);

/**
 * Regex patterns for extracting DSN from code.
 * DSN_PATTERN_INIT: Matches Sentry.init({ dsn: "..." })
 * DSN_PATTERN_GENERIC: Matches any dsn: "https://..." pattern
 */
const DSN_PATTERN_INIT =
  /Sentry\.init\s*\(\s*\{[^}]*dsn\s*:\s*["'`]([^"'`]+)["'`]/s;
const DSN_PATTERN_GENERIC = /dsn\s*:\s*["'`](https?:\/\/[^"'`]+@[^"'`]+)["'`]/s;

/**
 * Extract DSN string from code content using regex
 *
 * @param content - Source code content
 * @returns DSN string or null if not found
 */
export function extractDsnFromCode(content: string): string | null {
  // Try Sentry.init pattern first (more specific)
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
 * Check if a path should be skipped during scanning
 */
function shouldSkipPath(filepath: string): boolean {
  const parts = filepath.split("/");
  return parts.some((part) => SKIP_DIRS.has(part));
}

/**
 * Detect DSN from JavaScript/TypeScript source code
 *
 * Scans all JS/TS files in the directory (excluding node_modules, etc.)
 * and returns the first valid DSN found.
 *
 * @param cwd - Directory to search in
 * @returns First detected DSN or null if not found
 */
export async function detectFromCode(cwd: string): Promise<DetectedDsn | null> {
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
        return createDetectedDsn(dsn, "code", relativePath);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return null;
}

/**
 * Detect DSN from ALL JavaScript/TypeScript source files (for conflict detection)
 *
 * Unlike detectFromCode, this doesn't stop at the first match.
 * Used to find all DSNs when checking for conflicts.
 *
 * @param cwd - Directory to search in
 * @returns Array of all detected DSNs
 */
export async function detectAllFromCode(cwd: string): Promise<DetectedDsn[]> {
  const results: DetectedDsn[] = [];

  for await (const relativePath of CODE_GLOB.scan({ cwd, onlyFiles: true })) {
    if (shouldSkipPath(relativePath)) {
      continue;
    }

    const filepath = join(cwd, relativePath);
    const file = Bun.file(filepath);

    try {
      const content = await file.text();
      const dsn = extractDsnFromCode(content);

      if (dsn) {
        const detected = createDetectedDsn(dsn, "code", relativePath);
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
