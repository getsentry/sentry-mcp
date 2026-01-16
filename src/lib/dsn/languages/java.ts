/**
 * Java/Kotlin DSN Detection
 *
 * Detects DSN from Java and Kotlin source code patterns.
 * Also checks sentry.properties files.
 * Looks for options.setDsn("...") and dsn=... patterns.
 */

import type { LanguageDetector } from "./types.js";

/**
 * Regex for Java/Kotlin code: options.setDsn("...")
 */
const DSN_PATTERN_SET_DSN = /\.setDsn\s*\(\s*["']([^"']+)["']\s*\)/s;

/**
 * Regex for sentry.properties file: dsn=...
 */
const DSN_PATTERN_PROPERTIES = /^dsn\s*=\s*(.+)$/m;

/**
 * Generic pattern for DSN in annotations or config
 * Matches: dsn = "..." or "dsn", "..."
 */
const DSN_PATTERN_GENERIC =
  /["']?dsn["']?\s*[=,]\s*["'](https?:\/\/[^"']+@[^"']+)["']/s;

/**
 * Extract DSN string from Java/Kotlin code or properties content.
 *
 * @param content - Source code or properties content
 * @returns DSN string or null if not found
 */
export function extractDsnFromJava(content: string): string | null {
  // Try setDsn() pattern first (most common in Java)
  const setDsnMatch = content.match(DSN_PATTERN_SET_DSN);
  if (setDsnMatch?.[1]) {
    return setDsnMatch[1];
  }

  // Try properties file pattern (dsn=...)
  const propsMatch = content.match(DSN_PATTERN_PROPERTIES);
  if (propsMatch?.[1]) {
    const dsn = propsMatch[1].trim();
    // Validate it looks like a DSN
    if (dsn.startsWith("https://") && dsn.includes("@")) {
      return dsn;
    }
  }

  // Try generic pattern
  const genericMatch = content.match(DSN_PATTERN_GENERIC);
  if (genericMatch?.[1]) {
    return genericMatch[1];
  }

  return null;
}

/**
 * Java/Kotlin language detector.
 */
export const javaDetector: LanguageDetector = {
  name: "Java",
  extensions: [".java", ".kt", ".properties"],
  skipDirs: [
    "target",
    "build",
    ".gradle",
    ".idea",
    ".git",
    "out",
    "bin",
    ".mvn",
  ],
  extractDsn: extractDsnFromJava,
};
