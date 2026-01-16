/**
 * Go DSN Detection
 *
 * Detects DSN from Go source code patterns.
 * Looks for sentry.Init(sentry.ClientOptions{Dsn: "..."}) and similar patterns.
 */

import type { LanguageDetector } from "./types.js";

/**
 * Regex pattern for DSN in Go struct initialization.
 * Matches: Dsn: "https://...@..." in sentry.ClientOptions{}
 */
const DSN_PATTERN_STRUCT = /Dsn:\s*["'](https?:\/\/[^"']+@[^"']+)["']/s;

/**
 * Generic pattern for dsn assignment
 * Matches: dsn := "..." or dsn = "..."
 */
const DSN_PATTERN_ASSIGN = /dsn\s*:?=\s*["`](https?:\/\/[^"`]+@[^"`]+)["`]/is;

/**
 * Extract DSN string from Go code content.
 *
 * @param content - Source code content
 * @returns DSN string or null if not found
 */
export function extractDsnFromGo(content: string): string | null {
  // Try struct field pattern first (most common)
  const structMatch = content.match(DSN_PATTERN_STRUCT);
  if (structMatch?.[1]) {
    return structMatch[1];
  }

  // Try assignment pattern
  const assignMatch = content.match(DSN_PATTERN_ASSIGN);
  if (assignMatch?.[1]) {
    return assignMatch[1];
  }

  return null;
}

/**
 * Go language detector.
 */
export const goDetector: LanguageDetector = {
  name: "Go",
  extensions: [".go"],
  skipDirs: ["vendor", ".git", "testdata"],
  extractDsn: extractDsnFromGo,
};
