/**
 * DSN Types
 *
 * All types related to DSN parsing, detection, and caching.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Source where DSN was detected from
 *
 * - env: SENTRY_DSN environment variable
 * - env_file: .env file
 * - config: Language-specific config file (e.g., sentry.properties)
 * - code: Source code patterns (e.g., Sentry.init)
 */
export type DsnSource = "env" | "env_file" | "config" | "code";

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
  /** Extracted from oXXX.ingest... pattern in host (SaaS only) */
  orgId?: string;
};

/**
 * Detected DSN with source information
 */
export type DetectedDsn = ParsedDsn & {
  /** Original DSN string */
  raw: string;
  /** Where the DSN was found */
  source: DsnSource;
  /** File path (relative to cwd) if detected from file */
  sourcePath?: string;
  /** Cached resolution info if available */
  resolved?: ResolvedProjectInfo;
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolution Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolved project information from Sentry API
 */
export type ResolvedProjectInfo = {
  orgSlug: string;
  orgName: string;
  projectSlug: string;
  projectName: string;
};

/**
 * Full resolved project with DSN and source info
 */
export type ResolvedProject = ResolvedProjectInfo & {
  dsn: DetectedDsn;
  /** Human-readable description of where DSN was found */
  sourceDescription: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Cache Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cached DSN entry with full resolution info
 *
 * Stored in ~/.sentry-cli-next/config.json under dsnCache[directory]
 */
export type CachedDsnEntry = {
  /** The raw DSN string */
  dsn: string;
  /** Project ID extracted from DSN */
  projectId: string;
  /** Org ID extracted from DSN (SaaS only) */
  orgId?: string;
  /** Where the DSN was found */
  source: DsnSource;
  /** Relative path to the source file */
  sourcePath?: string;
  /** Resolved project info (avoids API call on cache hit) */
  resolved?: ResolvedProjectInfo;
  /** Timestamp when this entry was cached */
  cachedAt: number;
};

/**
 * Zod schema for ResolvedProjectInfo
 */
export const ResolvedProjectInfoSchema = z.object({
  orgSlug: z.string(),
  orgName: z.string(),
  projectSlug: z.string(),
  projectName: z.string(),
});

/**
 * Zod schema for cached DSN entries (for config validation)
 */
export const CachedDsnEntrySchema = z.object({
  dsn: z.string(),
  projectId: z.string(),
  orgId: z.string().optional(),
  source: z.enum(["env", "env_file", "config", "code"]),
  sourcePath: z.string().optional(),
  resolved: ResolvedProjectInfoSchema.optional(),
  cachedAt: z.number(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Detection Result Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of DSN detection (may have conflicts)
 */
export type DsnDetectionResult = {
  /** Primary DSN to use (null if conflict or not found) */
  primary: DetectedDsn | null;
  /** All detected DSNs (for conflict reporting) */
  all: DetectedDsn[];
  /** Whether there's a conflict (multiple different DSNs) */
  conflict: boolean;
  /** Detected project language (for future use) */
  language?: string;
};
