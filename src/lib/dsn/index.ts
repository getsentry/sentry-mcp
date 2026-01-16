/**
 * DSN Detection Module
 *
 * Public API for detecting Sentry DSN in a project directory.
 *
 * @example
 * import { detectDsn, resolveProject } from "./lib/dsn/index.js";
 *
 * // Detect DSN (uses cache for speed)
 * const dsn = await detectDsn(process.cwd());
 *
 * // Resolve to project info
 * if (dsn) {
 *   const project = await resolveProject(process.cwd(), dsn);
 *   console.log(`Project: ${project.orgSlug}/${project.projectSlug}`);
 * }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Main Detection API
// ─────────────────────────────────────────────────────────────────────────────

export {
  detectAllDsns,
  detectDsn,
  getDsnSourceDescription,
} from "./detector.js";

// ─────────────────────────────────────────────────────────────────────────────
// Project Resolution
// ─────────────────────────────────────────────────────────────────────────────

export { getAccessibleProjects, resolveProject } from "./resolver.js";

// ─────────────────────────────────────────────────────────────────────────────
// Error Formatting
// ─────────────────────────────────────────────────────────────────────────────

export {
  formatConflictError,
  formatNoDsnError,
  formatResolutionError,
} from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Cache Management
// ─────────────────────────────────────────────────────────────────────────────

export {
  clearDsnCache,
  getCachedDsn,
  setCachedDsn,
  updateCachedResolution,
} from "./cache.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  CachedDsnEntry,
  DetectedDsn,
  DsnDetectionResult,
  DsnSource,
  ParsedDsn,
  ResolvedProject,
  ResolvedProjectInfo,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities (for advanced use)
// ─────────────────────────────────────────────────────────────────────────────

export {
  createDetectedDsn,
  extractOrgIdFromHost,
  isValidDsn,
  parseDsn,
} from "./parser.js";
