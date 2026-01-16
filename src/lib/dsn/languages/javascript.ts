/**
 * JavaScript/TypeScript DSN Detection
 *
 * Detects DSN from JavaScript and TypeScript source code patterns.
 * Looks for Sentry.init({ dsn: "..." }) and similar patterns.
 */

import type { LanguageDetector } from "./types.js";

/**
 * Regex patterns for extracting DSN from code.
 * DSN_PATTERN_INIT: Matches Sentry.init({ dsn: "..." })
 * DSN_PATTERN_GENERIC: Matches any dsn: "https://..." pattern
 */
const DSN_PATTERN_INIT =
  /Sentry\.init\s*\(\s*\{[^}]*dsn\s*:\s*["'`]([^"'`]+)["'`]/s;
const DSN_PATTERN_GENERIC = /dsn\s*:\s*["'`](https?:\/\/[^"'`]+@[^"'`]+)["'`]/s;

/**
 * Extract DSN string from JavaScript/TypeScript code content.
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
 * JavaScript/TypeScript language detector.
 */
export const javascriptDetector: LanguageDetector = {
  name: "JavaScript",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  skipDirs: [
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
  ],
  extractDsn: extractDsnFromCode,
};
