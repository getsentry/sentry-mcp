/**
 * Language Detector Interface
 *
 * Common interface for all language-specific DSN detectors.
 * Each language implements this interface to detect DSNs from its source files.
 */

/**
 * Language-specific DSN detector.
 * Each supported language provides a detector implementing this type.
 */
export type LanguageDetector = {
  /** Display name for the language (e.g., "Python", "JavaScript") */
  name: string;

  /** File extensions to scan (e.g., [".py"], [".ts", ".tsx"]) */
  extensions: string[];

  /** Directories to skip when scanning (e.g., ["node_modules", "venv"]) */
  skipDirs: string[];

  /**
   * Extract DSN string from file content.
   *
   * @param content - File content to search
   * @returns DSN string if found, null otherwise
   */
  extractDsn: (content: string) => string | null;
};
