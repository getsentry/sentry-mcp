/**
 * Python DSN Detection
 *
 * Detects DSN from Python source code patterns.
 * Looks for sentry_sdk.init(dsn="...") and similar patterns.
 */

import type { LanguageDetector } from "./types.js";

/**
 * Regex patterns for extracting DSN from Python code.
 * Matches: sentry_sdk.init(dsn="...") or sentry_sdk.init(dsn='...')
 * Also matches keyword argument style: sentry_sdk.init(\n    dsn="...",\n)
 */
const DSN_PATTERN_INIT =
  /sentry_sdk\.init\s*\([^)]*dsn\s*=\s*["']([^"']+)["']/s;

/**
 * Generic pattern for dsn= in Python (catches dict-style configs)
 * Matches: "dsn": "..." or 'dsn': '...' or dsn="..." or dsn='...'
 */
const DSN_PATTERN_GENERIC =
  /["']?dsn["']?\s*[:=]\s*["'](https?:\/\/[^"']+@[^"']+)["']/s;

/**
 * Extract DSN string from Python code content.
 *
 * @param content - Source code content
 * @returns DSN string or null if not found
 */
export function extractDsnFromPython(content: string): string | null {
  // Try sentry_sdk.init pattern first (more specific)
  const initMatch = content.match(DSN_PATTERN_INIT);
  if (initMatch?.[1]) {
    return initMatch[1];
  }

  // Try generic dsn pattern
  const genericMatch = content.match(DSN_PATTERN_GENERIC);
  if (genericMatch?.[1]) {
    return genericMatch[1];
  }

  return null;
}

/**
 * Python language detector.
 */
export const pythonDetector: LanguageDetector = {
  name: "Python",
  extensions: [".py"],
  skipDirs: [
    "venv",
    ".venv",
    "env",
    ".env",
    "__pycache__",
    ".tox",
    ".nox",
    "site-packages",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
  ],
  extractDsn: extractDsnFromPython,
};
