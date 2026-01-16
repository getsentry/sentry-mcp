/**
 * Language Detection Registry
 *
 * Unified scanner for detecting DSN from source code across all supported languages.
 * Uses a registry of language detectors to scan files by extension.
 */

import { extname, join } from "node:path";
import { createDetectedDsn } from "../parser.js";
import type { DetectedDsn } from "../types.js";
import { goDetector } from "./go.js";
import { javaDetector } from "./java.js";
import { javascriptDetector } from "./javascript.js";
import { phpDetector } from "./php.js";
import { pythonDetector } from "./python.js";
import { rubyDetector } from "./ruby.js";
import type { LanguageDetector } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/** All supported language detectors */
export const languageDetectors: LanguageDetector[] = [
  javascriptDetector,
  pythonDetector,
  phpDetector,
  rubyDetector,
  goDetector,
  javaDetector,
];

/** Map of file extension to detector for fast lookup */
const extensionToDetector = new Map<string, LanguageDetector>();
for (const detector of languageDetectors) {
  for (const ext of detector.extensions) {
    extensionToDetector.set(ext, detector);
  }
}

/** Combined set of all skip directories */
const allSkipDirs = new Set<string>();
for (const detector of languageDetectors) {
  for (const dir of detector.skipDirs) {
    allSkipDirs.add(dir);
  }
}

/** Glob pattern matching all supported file extensions */
const allExtensions = languageDetectors.flatMap((d) => d.extensions);
const globPattern = `**/*{${allExtensions.join(",")}}`;
const codeGlob = new Bun.Glob(globPattern);

// ─────────────────────────────────────────────────────────────────────────────
// Scanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a path should be skipped during scanning.
 * Matches any path segment against the combined skip directories from all detectors.
 *
 * @param filepath - Relative file path to check
 * @returns True if any path segment matches a skip directory
 */
function shouldSkipPath(filepath: string): boolean {
  const parts = filepath.split("/");
  return parts.some((part) => allSkipDirs.has(part));
}

/**
 * Get the appropriate detector for a file based on its extension.
 *
 * @param filepath - File path to get detector for
 * @returns The matching detector, or undefined if no detector handles this extension
 */
function getDetectorForFile(filepath: string): LanguageDetector | undefined {
  const ext = extname(filepath);
  return extensionToDetector.get(ext);
}

/**
 * Detect DSN from source code files in a directory.
 * Scans all supported languages and returns the first DSN found.
 *
 * @param cwd - Directory to search in
 * @returns First detected DSN or null if not found
 */
export async function detectFromCode(cwd: string): Promise<DetectedDsn | null> {
  for await (const relativePath of codeGlob.scan({ cwd, onlyFiles: true })) {
    if (shouldSkipPath(relativePath)) {
      continue;
    }

    const detector = getDetectorForFile(relativePath);
    if (!detector) {
      continue;
    }

    const filepath = join(cwd, relativePath);

    try {
      const content = await Bun.file(filepath).text();
      const dsn = detector.extractDsn(content);

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
 * Detect DSN from ALL source code files (for conflict detection).
 * Unlike detectFromCode, this doesn't stop at the first match.
 *
 * @param cwd - Directory to search in
 * @returns Array of all detected DSNs
 */
export async function detectAllFromCode(cwd: string): Promise<DetectedDsn[]> {
  const results: DetectedDsn[] = [];

  for await (const relativePath of codeGlob.scan({ cwd, onlyFiles: true })) {
    if (shouldSkipPath(relativePath)) {
      continue;
    }

    const detector = getDetectorForFile(relativePath);
    if (!detector) {
      continue;
    }

    const filepath = join(cwd, relativePath);

    try {
      const content = await Bun.file(filepath).text();
      const dsn = detector.extractDsn(content);

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
