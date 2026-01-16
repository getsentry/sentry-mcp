/**
 * PHP DSN Detection
 *
 * Detects DSN from PHP source code patterns.
 * Looks for \Sentry\init(['dsn' => '...']) and similar patterns.
 */

import type { LanguageDetector } from "./types.js";

/**
 * Regex patterns for extracting DSN from PHP code.
 * Matches: \Sentry\init(['dsn' => '...']) or Sentry\init(["dsn" => "..."])
 */
const DSN_PATTERN_INIT =
  /\\?Sentry\\init\s*\(\s*\[[^\]]*['"]dsn['"]\s*=>\s*['"]([^'"]+)['"]/s;

/**
 * Generic pattern for 'dsn' => '...' in PHP arrays
 */
const DSN_PATTERN_GENERIC =
  /['"]dsn['"]\s*=>\s*['"](https?:\/\/[^'"]+@[^'"]+)['"]/s;

/**
 * Extract DSN string from PHP code content.
 *
 * @param content - Source code content
 * @returns DSN string or null if not found
 */
export function extractDsnFromPhp(content: string): string | null {
  // Try Sentry\init pattern first (more specific)
  const initMatch = content.match(DSN_PATTERN_INIT);
  if (initMatch?.[1]) {
    return initMatch[1];
  }

  // Try generic 'dsn' => '...' pattern
  const genericMatch = content.match(DSN_PATTERN_GENERIC);
  if (genericMatch?.[1]) {
    return genericMatch[1];
  }

  return null;
}

/**
 * PHP language detector.
 */
export const phpDetector: LanguageDetector = {
  name: "PHP",
  extensions: [".php"],
  skipDirs: ["vendor", ".git", "cache", "storage/framework"],
  extractDsn: extractDsnFromPhp,
};
