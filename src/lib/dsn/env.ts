/**
 * Environment Variable Detection
 *
 * Detects DSN from SENTRY_DSN environment variable.
 * This is the highest priority source.
 */

import { createDetectedDsn } from "./parser.js";
import type { DetectedDsn } from "./types.js";

/** Environment variable name for Sentry DSN */
export const SENTRY_DSN_ENV = "SENTRY_DSN";

/**
 * Detect DSN from environment variable.
 *
 * @returns Detected DSN or null if not set/invalid
 *
 * @example
 * // With SENTRY_DSN=https://key@o123.ingest.sentry.io/456
 * const dsn = detectFromEnv();
 * // { raw: "...", source: "env", projectId: "456", ... }
 */
export function detectFromEnv(): DetectedDsn | null {
  const dsn = process.env[SENTRY_DSN_ENV];
  if (!dsn) {
    return null;
  }

  return createDetectedDsn(dsn, "env");
}
