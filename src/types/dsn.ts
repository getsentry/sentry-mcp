/**
 * DSN Types
 *
 * Types for Sentry DSN parsing and detection.
 */

/**
 * Parsed DSN components
 *
 * DSN Format: {PROTOCOL}://{PUBLIC_KEY}@{HOST}/{PROJECT_ID}
 * Example: https://abc123@o1169445.ingest.us.sentry.io/4505229541441536
 */
export type ParsedDsn = {
  protocol: string;
  publicKey: string;
  host: string;
  projectId: string;
  /** Extracted from oXXX.ingest... pattern in host */
  orgId?: string;
};

/**
 * Source where DSN was detected from
 */
export type DsnSource = "env" | "env_file" | "code";

/**
 * Detected DSN with source information
 */
export type DetectedDsn = ParsedDsn & {
  /** Original DSN string */
  raw: string;
  /** Where the DSN was found */
  source: DsnSource;
  /** File path if detected from file */
  sourcePath?: string;
};

/**
 * Cached project information from DSN resolution
 */
export type CachedProject = {
  orgSlug: string;
  orgName: string;
  projectSlug: string;
  projectName: string;
  cachedAt: number;
};
