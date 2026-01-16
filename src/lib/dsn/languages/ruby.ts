/**
 * Ruby DSN Detection
 *
 * Detects DSN from Ruby source code patterns.
 * Looks for Sentry.init { |config| config.dsn = '...' } and similar patterns.
 */

import type { LanguageDetector } from "./types.js";

/**
 * Regex patterns for extracting DSN from Ruby code.
 * Matches: config.dsn = '...' or config.dsn = "..."
 */
const DSN_PATTERN_CONFIG = /config\.dsn\s*=\s*['"]([^'"]+)['"]/s;

/**
 * Generic pattern for dsn in Ruby hashes
 * Matches: dsn: '...' or :dsn => '...'
 */
const DSN_PATTERN_HASH =
  /(?:dsn:|:dsn\s*=>)\s*['"](https?:\/\/[^'"]+@[^'"]+)['"]/s;

/**
 * Extract DSN string from Ruby code content.
 *
 * @param content - Source code content
 * @returns DSN string or null if not found
 */
export function extractDsnFromRuby(content: string): string | null {
  // Try config.dsn pattern first (most common in Sentry.init block)
  const configMatch = content.match(DSN_PATTERN_CONFIG);
  if (configMatch?.[1]) {
    return configMatch[1];
  }

  // Try hash-style pattern
  const hashMatch = content.match(DSN_PATTERN_HASH);
  if (hashMatch?.[1]) {
    return hashMatch[1];
  }

  return null;
}

/**
 * Ruby language detector.
 */
export const rubyDetector: LanguageDetector = {
  name: "Ruby",
  extensions: [".rb"],
  skipDirs: [
    "vendor/bundle",
    ".bundle",
    "tmp",
    "log",
    ".git",
    "coverage",
    "pkg",
  ],
  extractDsn: extractDsnFromRuby,
};
