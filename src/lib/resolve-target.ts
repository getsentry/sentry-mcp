/**
 * Target Resolution
 *
 * Shared utilities for resolving organization and project context from
 * various sources: CLI flags, environment variables, config defaults,
 * and DSN detection.
 *
 * Resolution priority (highest to lowest):
 * 1. Explicit CLI flags
 * 2. SENTRY_ORG / SENTRY_PROJECT environment variables
 * 3. `.sentryclirc` config file (walked up from CWD, merged with global)
 * 4. Config defaults (SQLite)
 * 5. DSN auto-detection (source code, .env files, environment variables)
 * 6. Directory name inference (matches project slugs with word boundaries)
 */

import { basename } from "node:path";
import { isatty } from "node:tty";
import pLimit from "p-limit";
import type { SentryOrganization, SentryProject } from "../types/index.js";
import {
  findProjectByDsnKey,
  findProjectsByPattern,
  findProjectsBySlug,
  getProject,
  listOrganizations,
  listProjects,
  resolveOrgDisplayName,
} from "./api-client.js";
import {
  looksLikeIssueShortId,
  type ParsedOrgProject,
  parseOrgProjectArg,
} from "./arg-parsing.js";
import { isAuthenticated } from "./db/auth.js";
import {
  getDefaultOrganization,
  getDefaultProject,
  setDefaultOrganization,
  setDefaultProject,
} from "./db/defaults.js";
import { getCachedDsn, setCachedDsn } from "./db/dsn-cache.js";
import {
  getCachedProject,
  getCachedProjectByDsnKey,
  getCachedProjectBySlug,
  setCachedProject,
  setCachedProjectByDsnKey,
} from "./db/project-cache.js";
import { getOrgByNumericId } from "./db/regions.js";
import type { DetectedDsn, DsnDetectionResult } from "./dsn/index.js";
import {
  detectAllDsns,
  detectDsn,
  findProjectRoot,
  formatMultipleProjectsFooter,
  getDsnSourceDescription,
} from "./dsn/index.js";
import { getEnv } from "./env.js";
import {
  ApiError,
  CliError,
  ContextError,
  ResolutionError,
  ValidationError,
  withAuthGuard,
} from "./errors.js";
import { fuzzyMatch } from "./fuzzy.js";
import { interactivePromptsAllowed } from "./interactive-prompts.js";
import { logger } from "./logger.js";
import { resolveEffectiveOrg } from "./region.js";
import { CONFIG_FILENAME, loadSentryCliRc } from "./sentryclirc.js";
import { setOrgProjectContext, withTracingSpan } from "./telemetry.js";
import { isAllDigits } from "./utils.js";

const log = logger.withTag("resolve-target");

/**
 * Set telemetry context from a resolved target and return it.
 * Eliminates boilerplate — every resolution function can call this on success.
 */
function withTelemetryContext<T extends { org: string; project?: string }>(
  result: T
): T {
  setOrgProjectContext([result.org], result.project ? [result.project] : []);
  return result;
}

/**
 * Convert a string or numeric ID to a positive integer, or `undefined` if the
 * value is absent, non-numeric, or not a positive integer.
 *
 * Sentry project/org IDs are always positive integers, so `0` and negative
 * values are treated as absent rather than valid IDs.
 */
export function toNumericId(
  id: string | number | null | undefined
): number | undefined {
  if (id === null || id === undefined) {
    return;
  }
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Resolved organization and project target for API calls.
 */
export type ResolvedTarget = {
  /** Organization slug for API calls */
  org: string;
  /** Project slug for API calls */
  project: string;
  /** Numeric project ID for API query params (avoids "not actively selected" errors) */
  projectId?: number;
  /** Human-readable org name (falls back to slug) */
  orgDisplay: string;
  /** Human-readable project name (falls back to slug) */
  projectDisplay: string;
  /** Source description if auto-detected (e.g., ".env.local", "src/index.ts") */
  detectedFrom?: string;
  /** Package path in monorepo (e.g., "packages/frontend") */
  packagePath?: string;
  /** Full project data when already fetched (avoids redundant getProject re-fetch) */
  projectData?: SentryProject;
};

/**
 * Result of resolving all targets (for monorepo-aware commands).
 */
export type ResolvedTargets = {
  /** All resolved targets */
  targets: ResolvedTarget[];
  /** Footer message to display if multiple projects detected */
  footer?: string;
  /** Number of self-hosted DSNs that were detected but couldn't be resolved */
  skippedSelfHosted?: number;
  /** All detected DSNs (for fingerprinting in alias cache) */
  detectedDsns?: DetectedDsn[];
};

/**
 * Resolved organization for API calls (without project).
 */
export type ResolvedOrg = {
  /** Organization slug for API calls */
  org: string;
  /** Source description if auto-detected */
  detectedFrom?: string;
};

/**
 * Options for resolving org and project.
 */
export type ResolveOptions = {
  /** Organization slug */
  org?: string;
  /** Project slug */
  project?: string;
  /** Current working directory for DSN detection */
  cwd: string;
  /** Usage hint shown when only one of org/project is provided */
  usageHint?: string;
  /**
   * Whether an interactive org/project picker may be shown when auto-detection
   * fails. Only consulted by {@link resolveOrgProjectOrGuide}. When omitted, it
   * is inferred from whether stdin **and** stdout are TTYs (so piped/`--json`
   * invocations never block on a prompt).
   */
  interactive?: boolean;
};

/**
 * Options for resolving org only.
 */
export type ResolveOrgOptions = {
  /** Organization slug */
  org?: string;
  /** Current working directory for DSN detection */
  cwd: string;
};

/**
 * Resolve organization and project from DSN detection.
 * Uses cached project info when available, otherwise fetches and caches it.
 *
 * @param cwd - Current working directory to search for DSN
 * @returns Resolved target with org/project info, or null if DSN not found
 */
export async function resolveFromDsn(
  cwd: string
): Promise<ResolvedTarget | null> {
  const dsn = await detectDsn(cwd);
  if (!(dsn?.orgId && dsn.projectId)) {
    return null;
  }

  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache first
  const cached = getCachedProject(dsn.orgId, dsn.projectId);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      projectId: toNumericId(cached.projectId),
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
    };
  }

  // Cache miss — fetch project details and cache them
  const projectInfo = await getProject(dsn.orgId, dsn.projectId);

  if (projectInfo.organization) {
    const orgName = resolveOrgDisplayName(
      projectInfo.organization.slug,
      projectInfo.organization.name
    );
    setCachedProject(dsn.orgId, dsn.projectId, {
      orgSlug: projectInfo.organization.slug,
      orgName,
      projectSlug: projectInfo.slug,
      projectName: projectInfo.name,
      projectId: projectInfo.id,
    });

    return {
      org: projectInfo.organization.slug,
      project: projectInfo.slug,
      projectId: toNumericId(projectInfo.id),
      orgDisplay: orgName,
      projectDisplay: projectInfo.name,
      detectedFrom,
    };
  }

  // Fallback to numeric IDs if org info missing (rare edge case)
  return {
    org: dsn.orgId,
    project: dsn.projectId,
    projectId: toNumericId(projectInfo.id),
    orgDisplay: dsn.orgId,
    projectDisplay: projectInfo.name,
    detectedFrom,
  };
}

/**
 * Resolve organization only from DSN detection.
 *
 * @param cwd - Current working directory to search for DSN
 * @returns Resolved org info, or null if DSN not found
 */
export async function resolveOrgFromDsn(
  cwd: string
): Promise<ResolvedOrg | null> {
  const dsn = await detectDsn(cwd);
  if (!dsn?.orgId) {
    return null;
  }

  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache for org slug (only if we have both org and project IDs)
  if (dsn.projectId) {
    const cached = getCachedProject(dsn.orgId, dsn.projectId);
    if (cached) {
      return {
        org: cached.orgSlug,
        detectedFrom,
      };
    }
  }

  // Fall back to numeric org ID (API accepts both slug and numeric ID)
  return {
    org: dsn.orgId,
    detectedFrom,
  };
}

/**
 * Normalize a bare numeric org ID to an org slug.
 *
 * When the project cache is cold, resolveOrgFromDsn returns the raw numeric
 * org ID from the DSN host (e.g., "1169445"). Many API endpoints reject
 * numeric IDs (dashboards return 404/403). This resolves them:
 *
 * 1. Local DB cache lookup (getOrgByNumericId — fast, no API call)
 * 2. Refresh org list via listOrganizationsUncached to populate mapping
 * 3. Falls back to original ID if resolution fails
 *
 * Non-numeric identifiers (already slugs) are returned unchanged.
 *
 * @param orgId - Raw org identifier from DSN (numeric ID or slug)
 * @returns Org slug for API calls
 */
async function normalizeNumericOrg(orgId: string): Promise<string> {
  if (!isAllDigits(orgId)) {
    return orgId;
  }

  // Fast path: check local DB cache for numeric ID → slug mapping
  const cached = getOrgByNumericId(orgId);
  if (cached) {
    return cached.slug;
  }

  // Slow path: fetch org list to populate numeric ID → slug mapping.
  // resolveEffectiveOrg doesn't handle bare numeric IDs (only o-prefixed),
  // so we do a targeted refresh via listOrganizationsUncached().
  try {
    const { listOrganizationsUncached } = await import("./api-client.js");
    await listOrganizationsUncached();
  } catch {
    return orgId;
  }

  // Retry cache after refresh
  const afterRefresh = getOrgByNumericId(orgId);
  return afterRefresh?.slug ?? orgId;
}

/**
 * Resolve a DSN without orgId by searching for the project via DSN public key.
 * Uses the /api/0/projects?query=dsn:<key> endpoint.
 *
 * @param dsn - Detected DSN (must have publicKey)
 * @returns Resolved target or null if resolution failed
 */
export async function resolveDsnByPublicKey(
  dsn: DetectedDsn
): Promise<ResolvedTarget | null> {
  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache first (keyed by publicKey for DSNs without orgId)
  const cached = getCachedProjectByDsnKey(dsn.publicKey);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      projectId: toNumericId(cached.projectId),
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
      packagePath: dsn.packagePath,
    };
  }

  // Cache miss — search for project by DSN public key
  const result = await withAuthGuard(async () => {
    const projectInfo = await findProjectByDsnKey(dsn.publicKey);

    if (!projectInfo) {
      return null;
    }

    if (projectInfo.organization) {
      const orgName = resolveOrgDisplayName(
        projectInfo.organization.slug,
        projectInfo.organization.name
      );
      setCachedProjectByDsnKey(dsn.publicKey, {
        orgSlug: projectInfo.organization.slug,
        orgName,
        projectSlug: projectInfo.slug,
        projectName: projectInfo.name,
        projectId: projectInfo.id,
      });

      return {
        org: projectInfo.organization.slug,
        project: projectInfo.slug,
        projectId: toNumericId(projectInfo.id),
        orgDisplay: orgName,
        projectDisplay: projectInfo.name,
        detectedFrom,
        packagePath: dsn.packagePath,
      };
    }

    // Project found but no org info - unusual but handle gracefully
    return null;
  });
  return result.ok ? result.value : null;
}

/**
 * Resolve a single detected DSN to a ResolvedTarget.
 * Uses cache when available, otherwise fetches from API.
 *
 * Supports two resolution paths:
 * 1. DSNs with orgId: Use getProject(orgId, projectId) API
 * 2. DSNs without orgId: Use findProjectByDsnKey(publicKey) API
 *
 * @param dsn - Detected DSN to resolve
 * @returns Resolved target or null if resolution failed
 */
async function resolveDsnToTarget(
  dsn: DetectedDsn
): Promise<ResolvedTarget | null> {
  // For DSNs without orgId (self-hosted or some SaaS patterns),
  // resolve by searching for the project via DSN public key
  if (!dsn.orgId) {
    return resolveDsnByPublicKey(dsn);
  }

  // Capture narrowed values before the closure (TS loses narrowing across closures)
  const orgId = dsn.orgId;
  const { projectId: dsnProjectId, packagePath } = dsn;
  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache first
  const cached = getCachedProject(orgId, dsnProjectId);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      projectId: toNumericId(cached.projectId),
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
      packagePath,
    };
  }

  // Cache miss — fetch project details and cache them
  const result = await withAuthGuard(async () => {
    const projectInfo = await getProject(orgId, dsnProjectId);

    if (projectInfo.organization) {
      const orgName = resolveOrgDisplayName(
        projectInfo.organization.slug,
        projectInfo.organization.name
      );
      setCachedProject(orgId, dsnProjectId, {
        orgSlug: projectInfo.organization.slug,
        orgName,
        projectSlug: projectInfo.slug,
        projectName: projectInfo.name,
        projectId: projectInfo.id,
      });

      return {
        org: projectInfo.organization.slug,
        project: projectInfo.slug,
        projectId: toNumericId(projectInfo.id),
        orgDisplay: orgName,
        projectDisplay: projectInfo.name,
        detectedFrom,
        packagePath,
      };
    }

    // Fallback to numeric IDs if org info missing
    return {
      org: orgId,
      project: dsnProjectId,
      projectId: toNumericId(projectInfo.id),
      orgDisplay: orgId,
      projectDisplay: projectInfo.name,
      detectedFrom,
      packagePath,
    };
  });
  return result.ok ? result.value : null;
}

/** Minimum directory name length for inference (avoids matching too broadly) */
const MIN_DIR_NAME_LENGTH = 2;

/**
 * Check if a directory name is valid for project inference.
 * Rejects empty strings, hidden directories, and names that are too short.
 *
 * @internal Exported for testing
 */
export function isValidDirNameForInference(dirName: string): boolean {
  if (!dirName || dirName.length < MIN_DIR_NAME_LENGTH) {
    return false;
  }
  // Reject hidden directories (starting with .) - includes ".", "..", ".git", ".env"
  if (dirName.startsWith(".")) {
    return false;
  }
  return true;
}

/**
 * Infer project(s) from directory name when DSN detection fails.
 * Uses word-boundary matching (`\b`) against all accessible projects.
 *
 * Caches results in dsn_cache with source: "inferred" for performance.
 * Cache is invalidated when directory mtime changes or after 24h TTL.
 *
 * @param cwd - Current working directory
 * @returns Resolved targets, or empty if no matches found
 */
async function inferFromDirectoryName(cwd: string): Promise<ResolvedTargets> {
  const { projectRoot } = await findProjectRoot(cwd);
  const dirName = basename(projectRoot);

  // Skip inference for invalid directory names
  if (!isValidDirNameForInference(dirName)) {
    return { targets: [] };
  }

  // Check cache first (reuse DSN cache with source: "inferred")
  const cached = getCachedDsn(projectRoot);
  if (cached?.source === "inferred") {
    const detectedFrom = `directory name "${dirName}"`;

    // Return all cached targets if available
    if (cached.allResolved && cached.allResolved.length > 0) {
      const targets = cached.allResolved.map((r) => ({
        org: r.orgSlug,
        project: r.projectSlug,
        orgDisplay: r.orgName,
        projectDisplay: r.projectName,
        detectedFrom,
      }));
      return {
        targets,
        footer:
          targets.length > 1
            ? `Found ${targets.length} projects matching directory "${dirName}"`
            : undefined,
      };
    }

    // Fallback to single resolved target (legacy cache entries)
    if (cached.resolved) {
      return {
        targets: [
          {
            org: cached.resolved.orgSlug,
            project: cached.resolved.projectSlug,
            orgDisplay: cached.resolved.orgName,
            projectDisplay: cached.resolved.projectName,
            detectedFrom,
          },
        ],
      };
    }
  }

  // Search for matching projects using word-boundary matching
  let matches: Awaited<ReturnType<typeof findProjectsByPattern>>;
  try {
    matches = await findProjectsByPattern(dirName);
  } catch {
    // If not authenticated or API fails, skip inference silently
    return { targets: [] };
  }

  if (matches.length === 0) {
    return { targets: [] };
  }

  // Cache all matches for faster subsequent lookups
  const [primary] = matches;
  if (primary) {
    const allResolved = matches.map((m) => ({
      orgSlug: m.orgSlug,
      orgName: m.organization?.name ?? m.orgSlug,
      projectSlug: m.slug,
      projectName: m.name,
    }));

    setCachedDsn(projectRoot, {
      dsn: "", // No DSN for inferred
      projectId: primary.id,
      source: "inferred",
      resolved: allResolved[0], // Primary for backwards compatibility
      allResolved,
    });
  }

  const detectedFrom = `directory name "${dirName}"`;
  const targets: ResolvedTarget[] = matches.map((m) => ({
    org: m.orgSlug,
    project: m.slug,
    projectId: toNumericId(m.id),
    orgDisplay: m.organization?.name ?? m.orgSlug,
    projectDisplay: m.name,
    detectedFrom,
  }));

  return {
    targets,
    footer:
      matches.length > 1
        ? `Found ${matches.length} projects matching directory "${dirName}"`
        : undefined,
  };
}

/**
 * Read org/project from SENTRY_ORG and SENTRY_PROJECT environment variables.
 *
 * SENTRY_PROJECT supports the `<org>/<project>` combo notation (presence of
 * `/` distinguishes it from a plain project slug). When the combo form is
 * used, SENTRY_ORG is ignored.
 *
 * @returns Resolved org+project, org-only, or null if no env vars are set
 */
function resolveFromEnvVars(): {
  org: string;
  project?: string;
  detectedFrom: string;
} | null {
  const rawProject = getEnv().SENTRY_PROJECT?.trim();

  // SENTRY_PROJECT=org/project combo takes priority.
  // If the value contains a slash it is always treated as combo notation;
  // a malformed combo (empty org or project part) is discarded entirely
  // so it cannot leak a slash into a project slug.
  if (rawProject?.includes("/")) {
    const slashIdx = rawProject.indexOf("/");
    const org = rawProject.slice(0, slashIdx);
    const project = rawProject.slice(slashIdx + 1);
    if (org && project) {
      return { org, project, detectedFrom: "SENTRY_PROJECT env var" };
    }
    // Malformed combo — fall through without using rawProject as a slug
    const envOrg = getEnv().SENTRY_ORG?.trim();
    return envOrg ? { org: envOrg, detectedFrom: "SENTRY_ORG env var" } : null;
  }

  const envOrg = getEnv().SENTRY_ORG?.trim();

  if (envOrg && rawProject) {
    return {
      org: envOrg,
      project: rawProject,
      detectedFrom: "SENTRY_ORG / SENTRY_PROJECT env vars",
    };
  }

  if (envOrg) {
    return { org: envOrg, detectedFrom: "SENTRY_ORG env var" };
  }

  return null;
}

/**
 * Find project slugs in the org that are similar to the given slug.
 *
 * Delegates to the shared {@link fuzzyMatch} utility which provides
 * exact, prefix, substring, and Levenshtein distance matching — so
 * typos like "senry" → "sentry" are caught in addition to simple
 * prefix/substring matches. Falls back gracefully on API errors
 * since this is a best-effort hint, not a critical path.
 *
 * @param org - Organization slug to search in
 * @param slug - The project slug that wasn't found
 * @returns Up to 3 similar project slugs, or empty array on error
 */
async function findSimilarProjects(
  org: string,
  slug: string
): Promise<string[]> {
  try {
    const projects = await listProjects(org);
    const slugs = projects.map((p) => p.slug);
    return fuzzyMatch(slug, slugs, { maxResults: 3 });
  } catch {
    // Best-effort — don't let listing failures block the error message
    return [];
  }
}

/**
 * Find similar project slugs across all accessible organizations.
 *
 * Used by project-search resolution when an exact slug match fails.
 * Lists projects in each org, then fuzzy-matches the slug against all
 * available project slugs. Best-effort: API or auth failures for individual
 * orgs are silently skipped.
 *
 * @param slug - The project slug that wasn't found
 * @param orgs - Accessible organizations to search
 * @returns Up to 5 similar projects with their org context, or empty array
 */
async function findSimilarProjectsAcrossOrgs(
  slug: string,
  orgs: { slug: string }[],
  /** Optional display name (e.g. user typed "My Project"). When provided,
   *  the search also fuzzy-matches against project display names, making
   *  it possible to resolve display-name input to the correct slug even
   *  when the slug convention differs (e.g. underscores vs dashes). */
  displayName?: string
): Promise<{ slug: string; orgSlug: string }[]> {
  try {
    const concurrency = pLimit(5);
    const orgProjects = await Promise.all(
      orgs.map((org) =>
        concurrency(async () => {
          const result = await withAuthGuard(() => listProjects(org.slug));
          if (!result.ok) {
            return [];
          }
          return result.value.map((p) => ({
            slug: p.slug,
            name: p.name,
            orgSlug: org.slug,
          }));
        })
      )
    );
    const allProjects = orgProjects.flat();

    // Deduplicate slugs so fuzzyMatch doesn't waste slots on the same
    // project appearing in multiple orgs.
    const uniqueSlugs = Array.from(new Set(allProjects.map((p) => p.slug)));
    const slugMatches = fuzzyMatch(slug, uniqueSlugs, { maxResults: 5 });

    // When a display name is provided (input contained spaces), also
    // fuzzy-match against project names. A name hit is mapped back to
    // the corresponding slug so callers get a uniform result shape.
    let nameMatchedSlugs: string[] = [];
    if (displayName) {
      const nameToSlug = new Map<string, string>();
      for (const p of allProjects) {
        // First slug wins — if multiple projects share a name, the first
        // encountered org's project is used. Ambiguity is resolved later
        // by the caller when results.length > 1.
        if (!nameToSlug.has(p.name)) {
          nameToSlug.set(p.name, p.slug);
        }
      }
      const uniqueNames = Array.from(nameToSlug.keys());
      const matchedNames = fuzzyMatch(displayName, uniqueNames, {
        maxResults: 5,
      });
      nameMatchedSlugs = matchedNames
        .map((n) => nameToSlug.get(n))
        .filter((s): s is string => s !== null && s !== undefined);
    }

    // Merge slug matches and name matches, preferring slug matches.
    const mergedSlugs = Array.from(
      new Set(slugMatches.concat(nameMatchedSlugs))
    );

    // Expand matched slugs back to org-qualified entries (may include
    // the same slug from multiple orgs — that's correct for suggestions).
    return mergedSlugs.flatMap((matched) =>
      allProjects.filter((p) => p.slug === matched)
    );
  } catch {
    return [];
  }
}

/** Result of a fuzzy project recovery attempt. */
type FuzzyRecoveryResult =
  | { kind: "match"; org: string; project: string }
  | { kind: "suggestions"; suggestions: string[] }
  | { kind: "none" };

/**
 * Attempt fuzzy matching when a project slug isn't found.
 *
 * Returns a discriminated result so callers can decide how to handle each
 * case (log, throw, or return empty for JSON mode). Does NOT log or throw
 * — callers own the side effects.
 *
 * - `match` — exactly one similar project found (unambiguous intent)
 * - `suggestions` — multiple matches, caller should show them
 * - `none` — no similar projects found
 */
export async function tryFuzzyProjectRecovery(
  slug: string,
  orgs: { slug: string }[],
  /** Optional display name for name-based matching (see {@link findSimilarProjectsAcrossOrgs}). */
  displayName?: string
): Promise<FuzzyRecoveryResult> {
  const similar = await findSimilarProjectsAcrossOrgs(slug, orgs, displayName);
  if (similar.length === 1) {
    const match = similar[0] as (typeof similar)[0];
    return { kind: "match", org: match.orgSlug, project: match.slug };
  }
  if (similar.length > 1) {
    return {
      kind: "suggestions",
      suggestions: [
        `Similar projects: ${similar.map((s) => `'${s.orgSlug}/${s.slug}'`).join(", ")}`,
      ],
    };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Project-not-found helper — shared across all resolution sites
// ---------------------------------------------------------------------------

/** Outcome of the "project not found" triage sequence. */
export type ProjectNotFoundOutcome =
  | { kind: "org-match"; orgSlug: string }
  | { kind: "fuzzy-match"; org: string; project: string }
  | { kind: "not-found"; displaySlug: string; suggestions: string[] };

/**
 * Triage a failed project-slug lookup.
 *
 * Runs the shared sequence that all resolution sites perform when
 * `findProjectsBySlug` returns no results:
 * 1. Check if the slug matches an organization (common mistake).
 * 2. Attempt fuzzy recovery (including display-name matching).
 * 3. If a single match is found, emit a warning and return it.
 * 4. Otherwise, build the "not found" suggestions list.
 *
 * The caller decides what to do with each outcome (throw, redirect,
 * recurse, verify-fetch, etc.).
 */
export async function triageProjectNotFound(
  slug: string,
  orgs: { slug: string }[],
  originalSlug?: string
): Promise<ProjectNotFoundOutcome> {
  const displaySlug = originalSlug ?? slug;

  // 1. Check if the slug matches an organization
  if (orgs.some((o) => o.slug === slug)) {
    return { kind: "org-match", orgSlug: slug };
  }

  // 2. Attempt fuzzy recovery — also match display names
  const fuzzy = await tryFuzzyProjectRecovery(slug, orgs, originalSlug);
  if (fuzzy.kind === "match") {
    log.warn(
      `No project matching '${displaySlug}'. Using '${fuzzy.project}' in org '${fuzzy.org}'.`
    );
    return { kind: "fuzzy-match", org: fuzzy.org, project: fuzzy.project };
  }

  // 3. Build "not found" result — pass through fuzzy suggestions or empty
  //    array so each caller can apply its own default hint.
  const suggestions = fuzzy.kind === "suggestions" ? fuzzy.suggestions : [];

  return { kind: "not-found", displaySlug, suggestions };
}

/**
 * Build {@link ResolutionError} suggestions when `getProject(org, project)` 404s.
 *
 * @param org - Organization slug from the user's target
 * @param project - Project segment that failed lookup (slug or numeric ID)
 * @param similar - Fuzzy-matched project slugs in the org, if any
 */
function buildProjectNotFoundSuggestions(
  org: string,
  project: string,
  similar: string[]
): string[] {
  const suggestions: string[] = [];
  if (isAllDigits(project)) {
    suggestions.push(
      "Project targets use slugs (e.g. 'frontend'), not numeric project IDs"
    );
  }
  if (similar.length > 0) {
    suggestions.push(
      `Similar projects: ${similar.map((s) => `'${s}'`).join(", ")}`
    );
  }
  suggestions.push(
    `Check the project slug at https://sentry.io/organizations/${org}/projects/`
  );
  return suggestions;
}

/**
 * Fetch the numeric project ID for an explicit org/project pair.
 *
 * Throws on auth errors and 404s (user-actionable). Returns undefined
 * for transient failures (network, 500s) so the command can still
 * attempt slug-based querying as a fallback.
 *
 * On 404, attempts to list similar projects in the org to help the
 * user find the correct slug (CLI-C0, 36 users).
 *
 * Consults the slug-based project cache first to avoid an extra
 * `GET /projects/{org}/{project}/` call on every `<org>/<project>`
 * invocation. The cache is populated by `listProjects()` (batch) and
 * by DSN resolution. Cache entries without a `projectId` fall through
 * to the API call (older rows from before schema v7).
 */
export async function fetchProjectId(
  org: string,
  project: string
): Promise<number | undefined> {
  // Cache-first: avoid a round trip when `listProjects()` or DSN resolution
  // has already populated the entry for this (org, project) slug pair.
  // Addresses the `sentry.issue.list` "Consecutive HTTP" performance issue
  // where the preflight project lookup ran before every issues fetch.
  const cached = getCachedProjectBySlug(org, project);
  if (cached?.projectId) {
    const numeric = toNumericId(cached.projectId);
    if (numeric !== undefined) {
      return numeric;
    }
  }

  const projectResult = await withAuthGuard(() => getProject(org, project));
  if (!projectResult.ok) {
    if (
      projectResult.error instanceof ApiError &&
      projectResult.error.status === 404
    ) {
      const similar = await findSimilarProjects(org, project);
      throw new ResolutionError(
        `Project '${project}'`,
        `not found in organization '${org}'`,
        `sentry project list ${org}/`,
        buildProjectNotFoundSuggestions(org, project, similar)
      );
    }
    return;
  }

  // Populate the cache for next time. The `getProject` response carries the
  // numeric project ID and (usually) the organization payload; use whatever
  // is available to seed future lookups. Guarded with try/catch so a broken
  // or read-only DB does NOT crash the primary API-success path.
  const project_ = projectResult.value;
  if (project_.organization) {
    try {
      setCachedProject(project_.organization.id, project_.id, {
        orgSlug: project_.organization.slug,
        orgName: resolveOrgDisplayName(
          project_.organization.slug,
          project_.organization.name
        ),
        projectSlug: project_.slug,
        projectName: project_.name,
        projectId: project_.id,
      });
    } catch (cacheErr) {
      log.debug(
        `Failed to cache project '${org}/${project}': ${String(cacheErr)}`
      );
    }
  }

  return toNumericId(project_.id);
}

/**
 * Resolve a project slug to its numeric ID for log queries, tolerating failures.
 *
 * Log listing and lookup scope by the `project` query param instead of the
 * `project:<slug>` search filter, which only matches projects that are actively
 * selected in the org (see #1317). This helper resolves the slug so callers can
 * pass a numeric ID.
 *
 * Behaviour:
 * - Numeric slug → returned as-is (already an ID).
 * - Slug that resolves → its numeric ID.
 * - Transient resolution failure → `undefined`, so the caller falls back to
 *   slug-based query scoping rather than failing the command.
 *
 * User-actionable errors from {@link fetchProjectId} — {@link AuthError},
 * {@link HostScopeError}, a 404 {@link ResolutionError}, and any other
 * {@link CliError} — are re-thrown so the command fails with a clear message
 * instead of silently degrading to slug scoping. Only genuinely unexpected
 * (non-{@link CliError}) failures are swallowed as transient.
 */
export async function resolveLogProjectId(
  org: string,
  project: string
): Promise<number | undefined> {
  if (isAllDigits(project)) {
    return Number(project);
  }
  try {
    return await fetchProjectId(org, project);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    log.debug(
      `Failed to resolve project ID for '${org}/${project}'; falling back to slug scoping`,
      error
    );
    return;
  }
}

/**
 * Maximum concurrent DSN resolution API calls.
 * Prevents overwhelming the Sentry API with parallel requests when
 * many DSNs are detected (e.g., monorepos or repos with test fixtures).
 */
const DSN_RESOLVE_CONCURRENCY = 5;

/**
 * Maximum time (ms) to spend resolving DSNs before returning partial results.
 * Prevents indefinite hangs when the API is slow or rate-limiting.
 */
const DSN_RESOLVE_TIMEOUT_MS = 15_000;

/**
 * Resolve DSNs with a concurrency limit and overall timeout.
 *
 * Uses p-limit's `map` helper for concurrency control and races it
 * against `AbortSignal.timeout` so the CLI never hangs indefinitely.
 * Queued tasks check the abort signal before doing work (same pattern
 * as code-scanner's earlyExit flag from PR #414). In-flight tasks that
 * already started are abandoned on timeout — their individual HTTP
 * timeouts (30s in sentry-client.ts) bound them independently.
 *
 * Results are written to a shared array so that tasks completing before
 * the deadline are captured even when the overall operation times out.
 *
 * @param dsns - Deduplicated DSNs to resolve
 * @returns Array of resolved targets (null for failures/timeouts)
 */
async function resolveDsnsWithTimeout(
  dsns: DetectedDsn[]
): Promise<(ResolvedTarget | null)[]> {
  const limit = pLimit(DSN_RESOLVE_CONCURRENCY);
  const signal = AbortSignal.timeout(DSN_RESOLVE_TIMEOUT_MS);

  // Shared results array — tasks write their result as they complete,
  // so partial results survive timeout.
  const results: (ResolvedTarget | null)[] = new Array(dsns.length).fill(null);

  const mapDone = limit.map(dsns, (dsn, i) => {
    if (signal.aborted) {
      return Promise.resolve(null);
    }
    return resolveDsnToTarget(dsn).then((target) => {
      results[i] = target;
      return target;
    });
  });

  // Race limit.map against the abort signal so in-flight tasks
  // don't block the timeout.
  const aborted = new Promise<"timeout">((resolve) => {
    signal.addEventListener("abort", () => resolve("timeout"), { once: true });
  });
  const raceResult = await Promise.race([
    mapDone.then(() => "done" as const),
    aborted,
  ]);

  if (raceResult === "timeout") {
    log.warn(
      `DSN resolution timed out after ${DSN_RESOLVE_TIMEOUT_MS / 1000}s, returning partial results`
    );
  }

  return results;
}

/**
 * Resolve all targets for monorepo-aware commands.
 *
 * When multiple DSNs are detected, resolves all of them in parallel
 * (with concurrency limiting) and returns a footer message for display.
 *
 * Resolution priority:
 * 1. Explicit org and project - returns single target
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars - returns single target
 * 3. `.sentryclirc` config file - returns single target
 * 4. Config defaults - returns single target
 * 5. DSN auto-detection - may return multiple targets
 * 6. Directory name inference - matches project slugs with word boundaries
 *
 * @param options - Resolution options with org, project, and cwd
 * @returns All resolved targets and optional footer message
 * @throws Error if only one of org/project is provided
 */
export async function resolveAllTargets(
  options: ResolveOptions
): Promise<ResolvedTargets> {
  return await withTracingSpan(
    "resolveAllTargets",
    "resolve",
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Priority-based resolution cascade requires sequential checks.
    async (span) => {
      const { org, project, cwd } = options;

      // 1. CLI flags take priority (both must be provided together)
      if (org && project) {
        span.setAttribute("resolve.method", "flags");
        setOrgProjectContext([org], [project]);
        return {
          targets: [
            {
              org,
              project,
              orgDisplay: org,
              projectDisplay: project,
            },
          ],
        };
      }

      // Error if only one flag is provided — not an auto-detect failure
      if (org || project) {
        throw new ContextError(
          "Organization and project",
          options.usageHint ?? "sentry <command> <org>/<project>",
          []
        );
      }

      log.debug("No explicit org/project flags provided, trying env vars");

      // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
      const envVars = resolveFromEnvVars();
      if (envVars?.project) {
        span.setAttribute("resolve.method", "env_vars");
        setOrgProjectContext([envVars.org], [envVars.project]);
        return {
          targets: [
            {
              org: envVars.org,
              project: envVars.project,
              orgDisplay: envVars.org,
              projectDisplay: envVars.project,
              detectedFrom: envVars.detectedFrom,
            },
          ],
        };
      }

      log.debug(
        `No SENTRY_ORG/SENTRY_PROJECT env vars, trying ${CONFIG_FILENAME} config file`
      );

      // 3. .sentryclirc config file (walked up from cwd, merged with global)
      const rcConfig = await loadSentryCliRc(cwd);
      if (rcConfig.org && rcConfig.project) {
        span.setAttribute("resolve.method", "sentryclirc");
        setOrgProjectContext([rcConfig.org], [rcConfig.project]);
        return {
          targets: [
            {
              org: rcConfig.org,
              project: rcConfig.project,
              orgDisplay: rcConfig.org,
              projectDisplay: rcConfig.project,
              detectedFrom: `${CONFIG_FILENAME} (${rcConfig.sources.project})`,
            },
          ],
        };
      }

      log.debug(`No ${CONFIG_FILENAME} org/project, trying config defaults`);

      // 4. Config defaults
      const defaultOrg = getDefaultOrganization();
      const defaultProject = getDefaultProject();
      if (defaultOrg && defaultProject) {
        span.setAttribute("resolve.method", "defaults");
        setOrgProjectContext([defaultOrg], [defaultProject]);
        return {
          targets: [
            {
              org: defaultOrg,
              project: defaultProject,
              orgDisplay: defaultOrg,
              projectDisplay: defaultProject,
            },
          ],
        };
      }

      log.debug("No config defaults set, trying DSN auto-detection");

      // 5. DSN auto-detection (may find multiple in monorepos)
      const detection = await detectAllDsns(cwd);

      if (detection.all.length === 0) {
        log.debug(
          "No DSNs found in source code or env files, trying directory name inference"
        );
        // 6. Fallback: infer from directory name
        const result = await inferFromDirectoryName(cwd);
        if (result.targets.length === 0) {
          span.setAttribute("resolve.method", "none");
          log.debug(
            "Directory name inference found no matching projects — auto-detection failed"
          );
        } else {
          span.setAttribute("resolve.method", "inference");
          const uniqueOrgs = [...new Set(result.targets.map((t) => t.org))];
          const uniqueProjects = [
            ...new Set(result.targets.map((t) => t.project)),
          ];
          setOrgProjectContext(uniqueOrgs, uniqueProjects);
        }
        return result;
      }

      span.setAttribute("resolve.method", "dsn");
      return resolveDetectedDsns(detection);
    },
    { "resolve.mode": "multi" }
  );
}

/**
 * Deduplicate detected DSNs and resolve them with concurrency limiting.
 *
 * Groups DSNs by (orgId, projectId) or publicKey, resolves one per unique
 * combination, then deduplicates resolved targets by org+project slug.
 *
 * @param detection - DSN detection result with all found DSNs
 * @returns Resolved targets with optional footer message
 */
async function resolveDetectedDsns(
  detection: DsnDetectionResult
): Promise<ResolvedTargets> {
  // Deduplicate DSNs by (orgId, projectId) or publicKey before resolution.
  // Multiple DSNs in test fixtures or monorepos can share the same org+project
  // — resolving each unique pair once avoids redundant API calls.
  const uniqueDsnMap = new Map<string, DetectedDsn>();
  for (const dsn of detection.all) {
    const dedupeKey = dsn.orgId
      ? `${dsn.orgId}:${dsn.projectId}`
      : `key:${dsn.publicKey}`;
    if (!uniqueDsnMap.has(dedupeKey)) {
      uniqueDsnMap.set(dedupeKey, dsn);
    }
  }
  const uniqueDsns = [...uniqueDsnMap.values()];

  log.debug(
    `Resolving ${uniqueDsns.length} unique DSN targets (${detection.all.length} total detected)`
  );

  // Resolve with concurrency limit to avoid overwhelming the Sentry API.
  // Without this, large repos can fire 100+ concurrent HTTP requests,
  // triggering rate limiting (429) and retry storms.
  const resolvedTargets = await resolveDsnsWithTimeout(uniqueDsns);

  // Filter out failed resolutions and deduplicate by org+project
  // (different orgId forms can resolve to the same org slug)
  const seen = new Set<string>();
  const targets = resolvedTargets.filter((t): t is ResolvedTarget => {
    if (t === null) {
      return false;
    }
    const key = `${t.org}:${t.project}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  // Count DSNs that couldn't be resolved (API errors, permissions, etc.)
  const unresolvedCount = resolvedTargets.filter((t) => t === null).length;

  if (targets.length === 0) {
    return {
      targets: [],
      skippedSelfHosted: unresolvedCount > 0 ? unresolvedCount : undefined,
      detectedDsns: detection.all,
    };
  }

  // Format footer if multiple projects detected
  const footer =
    targets.length > 1 ? formatMultipleProjectsFooter(targets) : undefined;

  // Set telemetry context for all resolved targets
  const uniqueOrgs = [...new Set(targets.map((t) => t.org))];
  const uniqueProjects = [...new Set(targets.map((t) => t.project))];
  setOrgProjectContext(uniqueOrgs, uniqueProjects);

  return {
    targets,
    footer,
    skippedSelfHosted: unresolvedCount > 0 ? unresolvedCount : undefined,
    detectedDsns: detection.all,
  };
}

/**
 * Resolve organization and project from multiple sources.
 *
 * Resolution priority:
 * 1. Explicit org and project - both must be provided together
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars
 * 3. `.sentryclirc` config file
 * 4. Config defaults
 * 5. DSN auto-detection
 * 6. Directory name inference - matches project slugs with word boundaries
 *
 * @param options - Resolution options with org, project, and cwd
 * @returns Resolved target, or null if resolution failed
 * @throws Error if only one of org/project is provided
 */
export async function resolveOrgAndProject(
  options: ResolveOptions
): Promise<ResolvedTarget | null> {
  return await withTracingSpan(
    "resolveOrgAndProject",
    "resolve",
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Priority-based resolution cascade requires sequential checks.
    async (span) => {
      const { org, project, cwd } = options;

      // 1. CLI flags take priority (both must be provided together)
      if (org && project) {
        span.setAttribute("resolve.method", "flags");
        return withTelemetryContext({
          org,
          project,
          orgDisplay: org,
          projectDisplay: project,
        });
      }

      // Error if only one flag is provided — not an auto-detect failure
      if (org || project) {
        throw new ContextError(
          "Organization and project",
          options.usageHint ?? "sentry <command> <org>/<project>",
          []
        );
      }

      // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
      const envVars = resolveFromEnvVars();
      if (envVars?.project) {
        span.setAttribute("resolve.method", "env_vars");
        return withTelemetryContext({
          org: envVars.org,
          project: envVars.project,
          orgDisplay: envVars.org,
          projectDisplay: envVars.project,
          detectedFrom: envVars.detectedFrom,
        });
      }

      // 3. .sentryclirc config file
      const rcConfig = await loadSentryCliRc(cwd);
      if (rcConfig.org && rcConfig.project) {
        span.setAttribute("resolve.method", "sentryclirc");
        return withTelemetryContext({
          org: rcConfig.org,
          project: rcConfig.project,
          orgDisplay: rcConfig.org,
          projectDisplay: rcConfig.project,
          detectedFrom: `${CONFIG_FILENAME} (${rcConfig.sources.project})`,
        });
      }

      // 4. Config defaults
      const defaultOrg = getDefaultOrganization();
      const defaultProject = getDefaultProject();
      if (defaultOrg && defaultProject) {
        span.setAttribute("resolve.method", "defaults");
        return withTelemetryContext({
          org: defaultOrg,
          project: defaultProject,
          orgDisplay: defaultOrg,
          projectDisplay: defaultProject,
        });
      }

      // 5. DSN auto-detection
      try {
        const dsnResult = await resolveFromDsn(cwd);
        if (dsnResult) {
          span.setAttribute("resolve.method", "dsn");
          return withTelemetryContext(dsnResult);
        }
      } catch {
        // Fall through to directory inference
      }

      // 6. Fallback: infer from directory name
      const inferred = await inferFromDirectoryName(cwd);
      const [first] = inferred.targets;
      if (!first) {
        // 7. Authenticated last resort: if the account has exactly one
        //    accessible org with exactly one project, that pair is the only
        //    possible target — use it instead of failing. This removes the
        //    "Could not auto-detect organization and project" dead-end for
        //    single-org/single-project accounts (CLI-3B). Callers that rely on
        //    a null return (e.g. event view's cross-org search) are unaffected:
        //    this only ever turns a null into a uniquely-determined target.
        const sole = await resolveSoleAccountTarget();
        if (sole) {
          span.setAttribute("resolve.method", "account_sole");
          return withTelemetryContext(sole);
        }
        span.setAttribute("resolve.method", "none");
        return null;
      }

      span.setAttribute("resolve.method", "inference");
      // If multiple matches, note it in detectedFrom
      return withTelemetryContext({
        ...first,
        detectedFrom:
          inferred.targets.length > 1
            ? `${first.detectedFrom} (1 of ${inferred.targets.length} matches)`
            : first.detectedFrom,
      });
    },
    { "resolve.mode": "single" }
  );
}

/**
 * Build a {@link ResolvedTarget} from an org/project pair, filling display
 * names and the numeric project ID from the fetched API objects.
 */
function toAccountTarget(
  org: SentryOrganization,
  project: SentryProject,
  detectedFrom: string
): ResolvedTarget {
  return {
    org: org.slug,
    project: project.slug,
    projectId: toNumericId(project.id),
    orgDisplay: org.name || org.slug,
    projectDisplay: project.name || project.slug,
    projectData: project,
    detectedFrom,
  };
}

/**
 * Last-resort resolution for authenticated users: when the account has exactly
 * one accessible organization containing exactly one project, that pair is the
 * only possible target, so return it instead of failing auto-detection.
 *
 * Returns `null` when not authenticated, when a lookup fails, or when there is
 * more than one (or zero) org/project — in those cases the choice is genuinely
 * ambiguous and must be made explicitly or via {@link resolveOrgProjectOrGuide}.
 *
 * This never throws and never prompts, so it is safe to call from the shared
 * {@link resolveOrgAndProject} cascade without affecting callers that depend on
 * a `null` return.
 */
async function resolveSoleAccountTarget(): Promise<ResolvedTarget | null> {
  if (!isAuthenticated()) {
    return null;
  }
  try {
    const orgs = await listOrganizations();
    const org = orgs.length === 1 ? orgs[0] : undefined;
    if (!org) {
      return null;
    }
    const projects = await listProjects(org.slug);
    const project = projects.length === 1 ? projects[0] : undefined;
    if (!project) {
      return null;
    }
    return toAccountTarget(org, project, "your only accessible org/project");
  } catch (error) {
    log.debug("Account-based auto-detect failed", error);
    return null;
  }
}

/**
 * Whether an interactive org/project picker may be shown. When `override` is
 * provided (e.g. derived from `--json`) it wins. Otherwise the picker is only
 * offered when JSON output is not active (so it never blocks a scripted run or
 * corrupts stdout JSON) **and** both stdin and stdout are TTYs (so piped or
 * redirected invocations never block on a prompt).
 */
function canPromptForTarget(override?: boolean): boolean {
  if (override !== undefined) {
    return override;
  }
  return interactivePromptsAllowed() && isatty(0) && isatty(1);
}

/**
 * Prompt the user (consola) to pick a value from a list, returning the selected
 * value or `null` if cancelled. A single-element list is auto-selected without
 * prompting.
 */
async function promptSelect(
  message: string,
  options: { label: string; value: string }[]
): Promise<string | null> {
  const sole = options[0];
  if (options.length === 1 && sole) {
    return sole.value;
  }
  const response = await log.prompt(message, { type: "select", options });
  // consola returns Symbol(clack:cancel) on Ctrl+C — a truthy non-string.
  return typeof response === "string" ? response : null;
}

/**
 * Interactively resolve an org/project for authenticated users and persist the
 * choice as the default. Returns `null` when not authenticated, when the
 * account has no accessible orgs/projects, or when the user cancels.
 */
async function promptForOrgProject(): Promise<ResolvedTarget | null> {
  if (!isAuthenticated()) {
    return null;
  }

  let orgs: SentryOrganization[];
  try {
    orgs = await listOrganizations();
  } catch (error) {
    log.debug("Failed to list organizations for interactive picker", error);
    return null;
  }
  if (orgs.length === 0) {
    return null;
  }

  const orgSlug = await promptSelect(
    "Select an organization:",
    orgs.map((o) => ({ label: o.name || o.slug, value: o.slug }))
  );
  if (!orgSlug) {
    return null;
  }
  const org = orgs.find((o) => o.slug === orgSlug);
  if (!org) {
    return null;
  }

  let projects: SentryProject[];
  try {
    projects = await listProjects(orgSlug);
  } catch (error) {
    log.debug("Failed to list projects for interactive picker", error);
    return null;
  }
  if (projects.length === 0) {
    throw new ResolutionError(
      `Organization '${orgSlug}'`,
      "has no accessible projects",
      `sentry project list ${orgSlug}/`
    );
  }

  const projectSlug = await promptSelect(
    "Select a project:",
    projects.map((p) => ({ label: p.name || p.slug, value: p.slug }))
  );
  if (!projectSlug) {
    return null;
  }
  const project = projects.find((p) => p.slug === projectSlug);
  if (!project) {
    return null;
  }

  // Persist as the default so the user is not prompted again. Best-effort: a
  // read-only DB must not fail the command after a successful selection.
  try {
    setDefaultOrganization(orgSlug);
    setDefaultProject(projectSlug);
    log.info(
      `Saved ${orgSlug}/${projectSlug} as your default. Change it with: sentry cli defaults org <slug>`
    );
  } catch (error) {
    log.debug("Failed to persist selected org/project as default", error);
  }

  return toAccountTarget(org, project, "interactive selection");
}

/**
 * Build an actionable {@link ContextError} for authenticated users whose
 * org/project could not be auto-detected. Lists the accessible organizations so
 * the next command is copy-pasteable, instead of the generic "run org list"
 * guidance shown to logged-out users.
 */
async function buildAccountContextError(
  usageHint: string
): Promise<ContextError> {
  try {
    const orgs = await listOrganizations();
    if (orgs.length > 0) {
      const shown = orgs.slice(0, 10).map((o) => `  ${o.slug}`);
      const more =
        orgs.length > shown.length
          ? `  …and ${orgs.length - shown.length} more`
          : "";
      const orgList = [...shown, more].filter(Boolean).join("\n");
      return new ContextError("Organization and project", usageHint, [
        `Specify one of your organizations:\n${orgList}`,
        "List a project: sentry project list <org>/",
        "Save a default: sentry cli defaults org <slug>",
      ]);
    }
  } catch (error) {
    log.debug("Failed to list organizations for context error", error);
  }
  // Fall back to the standard auto-detect guidance.
  return new ContextError("Organization and project", usageHint);
}

/**
 * Guide the user to a target after auto-detection has already failed.
 *
 * Call this only when `resolveOrgAndProject` (or `resolveAllTargets`) returned
 * no target. In order it:
 *
 * 1. Offers an interactive org/project picker (TTY only; saves the choice as a
 *    default), then
 * 2. For authenticated users, throws a {@link ContextError} listing their
 *    accessible organizations, otherwise
 * 3. Throws the standard auto-detect {@link ContextError}.
 *
 * Kept separate from {@link resolveOrgAndProject} so callers that mock the
 * resolver in tests (and rely on its `null` return, e.g. event view's cross-org
 * search) keep working — this is only invoked on the explicit failure path.
 *
 * @throws {ContextError} When the target cannot be resolved or chosen.
 * @throws {ResolutionError} When the interactively-selected organization has no
 *   accessible projects.
 */
export async function guideOrgProjectFailure(
  options: Pick<ResolveOptions, "usageHint" | "interactive">
): Promise<ResolvedTarget> {
  const usageHint = options.usageHint ?? "sentry <command> <org>/<project>";

  if (canPromptForTarget(options.interactive)) {
    const picked = await promptForOrgProject();
    if (picked) {
      return withTelemetryContext(picked);
    }
  }

  if (isAuthenticated()) {
    throw await buildAccountContextError(usageHint);
  }
  throw new ContextError("Organization and project", usageHint);
}

/**
 * Resolve an org/project target, guiding the user when auto-detection fails.
 *
 * Drop-in replacement for the `resolveOrgAndProject(...)` + "throw
 * `ContextError` on null" pattern, combining {@link resolveOrgAndProject} with
 * {@link guideOrgProjectFailure}.
 *
 * @throws {ContextError} When the target cannot be resolved or chosen.
 */
export async function resolveOrgProjectOrGuide(
  options: ResolveOptions
): Promise<ResolvedTarget> {
  const resolved = await resolveOrgAndProject(options);
  return resolved ?? (await guideOrgProjectFailure(options));
}

/**
 * Resolve organization only from multiple sources.
 *
 * Resolution priority:
 * 1. Positional argument
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars
 * 3. `.sentryclirc` config file
 * 4. Config defaults
 * 5. DSN auto-detection
 *
 * @param options - Resolution options with flag and cwd
 * @returns Resolved org, or null if resolution failed
 */
export async function resolveOrg(
  options: ResolveOrgOptions
): Promise<ResolvedOrg | null> {
  const { org, cwd } = options;

  // 1. CLI flag takes priority
  if (org) {
    setOrgProjectContext([org], []);
    return { org };
  }

  // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
  const envVars = resolveFromEnvVars();
  if (envVars) {
    setOrgProjectContext([envVars.org], []);
    return { org: envVars.org, detectedFrom: envVars.detectedFrom };
  }

  // 3. .sentryclirc config file (org only)
  const rcConfig = await loadSentryCliRc(cwd);
  if (rcConfig.org) {
    setOrgProjectContext([rcConfig.org], []);
    return {
      org: rcConfig.org,
      detectedFrom: `${CONFIG_FILENAME} (${rcConfig.sources.org})`,
    };
  }

  // 4. Config defaults
  const defaultOrg = getDefaultOrganization();
  if (defaultOrg) {
    setOrgProjectContext([defaultOrg], []);
    return { org: defaultOrg };
  }

  // 5. DSN auto-detection
  try {
    const result = await resolveOrgFromDsn(cwd);
    if (result) {
      // resolveOrgFromDsn may return a bare numeric org ID when the project
      // cache is cold. Normalize to a slug so API endpoints that reject
      // numeric IDs (e.g., dashboards) work correctly.
      const resolvedOrg = await normalizeNumericOrg(result.org);
      setOrgProjectContext([resolvedOrg], []);
      return { org: resolvedOrg, detectedFrom: result.detectedFrom };
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Search for a project by slug across all accessible organizations.
 *
 * Common resolution step used by commands that accept a bare project slug
 * (e.g., `sentry event view frontend <id>`). Throws helpful errors when
 * the project isn't found or exists in multiple orgs.
 *
 * @param projectSlug - Project slug to search for
 * @param usageHint - Usage example shown in error messages
 * @param disambiguationExample - Example command for multi-org disambiguation (e.g., "sentry event view <org>/frontend abc123")
 * @returns Resolved org, project slugs, and the full project data (avoids redundant re-fetch)
 * @throws {ContextError} If no project found
 * @throws {ValidationError} If project exists in multiple organizations
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-path resolution with fuzzy recovery is inherently branchy
export async function resolveProjectBySlug(
  projectSlug: string,
  usageHint: string,
  disambiguationExample?: string,
  /** Original user input before normalization — used for clearer messages. */
  originalSlug?: string
): Promise<{ org: string; project: string; projectData: SentryProject }> {
  /** Display label: the user's raw input when available, otherwise the slug. */
  const displaySlug = originalSlug ?? projectSlug;

  // When the input is a display name (originalSlug set, contains spaces),
  // skip the slug-based API lookup — it would just produce N 404s — and go
  // straight to display-name fuzzy matching via triageProjectNotFound.
  const isDisplayName = originalSlug !== undefined;
  const { projects, orgs } = isDisplayName
    ? { projects: [], orgs: await listOrganizations() }
    : await findProjectsBySlug(projectSlug);
  if (projects.length === 0) {
    const outcome = await triageProjectNotFound(
      projectSlug,
      orgs,
      originalSlug
    );

    if (outcome.kind === "org-match") {
      throw new ResolutionError(
        `'${projectSlug}'`,
        "is an organization, not a project",
        usageHint.replace("<org>/<project>", `${projectSlug}/<project>`),
        [
          `List projects: sentry project list ${projectSlug}/`,
          `Specify a project: ${projectSlug}/<project>`,
        ]
      );
    }

    if (outcome.kind === "fuzzy-match") {
      // Verify the recovered project is accessible before returning
      const proj = await withAuthGuard(() =>
        getProject(outcome.org, outcome.project)
      );
      if (proj.ok) {
        return withTelemetryContext({
          org: outcome.org,
          project: outcome.project,
          projectData: proj.value,
        });
      }
      // Recovery fetch failed — build a custom suggestion
      const defaultHint = isAllDigits(projectSlug)
        ? "No project with this ID was found — check the ID or use the project slug instead"
        : "Check that you have access to a project with this slug";
      throw new ResolutionError(
        `Project "${displaySlug}"`,
        "not found",
        usageHint,
        [
          `Similar project '${outcome.org}/${outcome.project}' was found but could not be accessed`,
          defaultHint,
        ]
      );
    }

    // outcome.kind === "not-found"
    let suggestions: string[];
    if (isAllDigits(projectSlug)) {
      suggestions = [
        "No project with this ID was found — check the ID or use the project slug instead",
      ];
    } else if (outcome.suggestions.length > 0) {
      suggestions = outcome.suggestions;
    } else {
      suggestions = ["Check that you have access to a project with this slug"];
    }
    throw new ResolutionError(
      `Project "${displaySlug}"`,
      "not found",
      usageHint,
      suggestions
    );
  }
  if (projects.length > 1) {
    const orgList = projects.map((p) => `  ${p.orgSlug}/${p.slug}`).join("\n");
    const example = disambiguationExample
      ? `\n\nExample: ${disambiguationExample}`
      : "";
    throw new ValidationError(
      `Project "${displaySlug}" exists in multiple organizations.\n\n` +
        `Specify the organization:\n${orgList}${example}`
    );
  }
  const foundProject = projects[0] as (typeof projects)[0];

  // When a numeric project ID resolved successfully, hint about using the slug
  if (isAllDigits(projectSlug) && foundProject.slug !== projectSlug) {
    log.warn(
      `Tip: Resolved project ID ${projectSlug} to ${foundProject.orgSlug}/${foundProject.slug}. ` +
        "Use the slug form for faster lookups."
    );
  }

  // Strip orgSlug (from ProjectWithOrg) so projectData is a clean SentryProject
  // — prevents leaking the extra field into JSON output when callers spread it.
  const { orgSlug: _org, ...projectData } = foundProject;
  return withTelemetryContext({
    org: foundProject.orgSlug,
    project: foundProject.slug,
    projectData,
  });
}

/** Result of resolving organizations to fetch from for listing commands */
export type OrgListResolution = {
  /** Organization slugs to list from */
  orgs: string[];
  /** Optional multi-org footer to display after listing */
  footer?: string;
  /** Number of self-hosted DSNs that could not be resolved */
  skippedSelfHosted?: number;
};

/**
 * Resolve which organizations to fetch data from for listing commands (team, repo).
 *
 * Resolution priority:
 * 1. Explicit org flag → use that single org
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars → use that org
 * 3. `.sentryclirc` config file → use org from config
 * 4. Config default org → use that org
 * 5. DSN auto-detection → extract unique orgs from detected targets
 * 6. No context found → empty list (caller must decide to show all orgs or error)
 *
 * @param orgFlag - Explicit org slug from CLI positional arg, or undefined
 * @param cwd - Current working directory for DSN detection
 * @returns Orgs to fetch and optional display metadata
 */
export async function resolveOrgsForListing(
  orgFlag: string | undefined,
  cwd: string
): Promise<OrgListResolution> {
  if (orgFlag) {
    setOrgProjectContext([orgFlag], []);
    return { orgs: [orgFlag] };
  }

  // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
  const envVars = resolveFromEnvVars();
  if (envVars) {
    setOrgProjectContext([envVars.org], []);
    return { orgs: [envVars.org] };
  }

  // 3. .sentryclirc config file
  const rcConfig = await loadSentryCliRc(cwd);
  if (rcConfig.org) {
    setOrgProjectContext([rcConfig.org], []);
    return { orgs: [rcConfig.org] };
  }

  // 4. Config defaults
  const defaultOrg = getDefaultOrganization();
  if (defaultOrg) {
    setOrgProjectContext([defaultOrg], []);
    return { orgs: [defaultOrg] };
  }

  const targetsResult = await withAuthGuard(() => resolveAllTargets({ cwd }));
  if (targetsResult.ok) {
    const { targets, footer, skippedSelfHosted } = targetsResult.value;
    if (targets.length > 0) {
      const uniqueOrgs = [
        ...new Set(targets.map((t: ResolvedTarget) => t.org)),
      ];
      setOrgProjectContext(uniqueOrgs, []);
      return { orgs: uniqueOrgs, footer, skippedSelfHosted };
    }
    return { orgs: [], skippedSelfHosted };
  }

  return { orgs: [] };
}

/** Resolved org and project returned by `resolveOrgProjectTarget` */
export type ResolvedOrgProject = {
  /** Organization slug */
  org: string;
  /** Project slug */
  project: string;
  /** Full project data when resolved via project-search (avoids redundant re-fetch) */
  projectData?: SentryProject;
};

/**
 * Resolve an org/project target for commands that require a single project
 * (trace list, log list). Rejects `org-all` mode since these commands require
 * a specific project.
 *
 * Handles:
 * - explicit `<org>/<project>` → use directly
 * - project-search `<project>` → find project across all orgs
 * - auto-detect → use DSN detection or config defaults
 * - org-all `<org>/` → throw ContextError asking for a specific project
 *
 * @param parsed - Parsed org/project argument
 * @param cwd - Current working directory for DSN auto-detection
 * @param commandName - Command name used in error messages (e.g., "trace list")
 * @returns Resolved org and project slugs
 * @throws {ContextError} When target cannot be resolved or org-all is used
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-mode dispatch with fuzzy recovery is inherently branchy
export async function resolveOrgProjectTarget(
  parsed: ParsedOrgProject,
  cwd: string,
  commandName: string
): Promise<ResolvedOrgProject> {
  const usageHint = `sentry ${commandName} <org>/<project>`;

  switch (parsed.type) {
    case "explicit": {
      const org = await resolveEffectiveOrg(parsed.org);
      return withTelemetryContext({ org, project: parsed.project });
    }

    case "org-all":
      throw new ContextError(
        "Project",
        `sentry ${commandName} ${parsed.org}/<project>`,
        []
      );

    case "project-search": {
      const displaySlug = parsed.originalSlug ?? parsed.projectSlug;
      const isDisplayName = parsed.originalSlug !== undefined;

      // Resolve DSN-style org identifiers (e.g. "o1081365" → "my-org")
      // before using the org for filtering.
      const scopedOrg = parsed.org
        ? await resolveEffectiveOrg(parsed.org)
        : undefined;

      const { projects: rawProjects, orgs: foundOrgs } = isDisplayName
        ? { projects: [], orgs: await listOrganizations() }
        : await findProjectsBySlug(parsed.projectSlug);

      // When the caller provided an org (e.g. "org/My Project"), scope the
      // search to that org instead of all accessible orgs. findProjectsBySlug
      // fans out across every accessible org, so the matched projects must be
      // filtered too — otherwise a slug that also exists in a different org
      // could be returned (or flagged ambiguous) despite the explicit scope.
      const orgs =
        scopedOrg !== undefined
          ? foundOrgs.filter((o) => o.slug === scopedOrg)
          : foundOrgs;
      const projects =
        scopedOrg !== undefined
          ? rawProjects.filter((p) => p.orgSlug === scopedOrg)
          : rawProjects;

      if (projects.length === 0) {
        const outcome = await triageProjectNotFound(
          parsed.projectSlug,
          orgs,
          parsed.originalSlug
        );

        if (outcome.kind === "org-match") {
          throw new ResolutionError(
            `'${parsed.projectSlug}'`,
            "is an organization, not a project",
            `sentry ${commandName} ${parsed.projectSlug}/<project>`,
            [`List projects: sentry project list ${parsed.projectSlug}/`]
          );
        }

        if (outcome.kind === "fuzzy-match") {
          return withTelemetryContext({
            org: outcome.org,
            project: outcome.project,
          });
        }

        const fallback = scopedOrg
          ? [
              `No project with this name found in organization '${scopedOrg}'`,
              `Check the organization slug or try: sentry project list ${scopedOrg}/`,
            ]
          : ["No project with this slug found in any accessible organization"];
        throw new ResolutionError(
          `Project '${displaySlug}'`,
          "not found",
          `sentry ${commandName} <org>/${parsed.projectSlug}`,
          outcome.suggestions.length > 0 ? outcome.suggestions : fallback
        );
      }

      if (projects.length > 1) {
        const options = projects
          .map((m) => `  sentry ${commandName} ${m.orgSlug}/${m.slug}`)
          .join("\n");
        throw new ResolutionError(
          `Project '${displaySlug}'`,
          "is ambiguous",
          `sentry ${commandName} <org>/${parsed.projectSlug}`,
          [
            `Found in ${projects.length} organizations. Specify one:\n${options}`,
          ]
        );
      }

      const match = projects[0] as (typeof projects)[number];
      const { orgSlug: _org, ...matchData } = match;
      return withTelemetryContext({
        org: match.orgSlug,
        project: match.slug,
        projectData: matchData,
      });
    }

    case "auto-detect": {
      // resolveOrgProjectOrGuide sets telemetry context and, when
      // auto-detection fails, offers an interactive picker (TTY) or an
      // actionable error listing the user's accessible orgs.
      const resolved = await resolveOrgProjectOrGuide({ cwd, usageHint });
      return { org: resolved.org, project: resolved.project };
    }

    default: {
      const _exhaustiveCheck: never = parsed;
      throw new Error(`Unexpected parsed type: ${_exhaustiveCheck}`);
    }
  }
}

/**
 * Resolve an org/project target from a raw CLI argument string for commands
 * that require a single project (trace list, log list).
 *
 * Convenience wrapper around `resolveOrgProjectTarget` that also calls
 * `parseOrgProjectArg` on the raw string argument.
 *
 * @param target - Raw CLI argument string (or undefined for auto-detect)
 * @param cwd - Current working directory for DSN auto-detection
 * @param commandName - Command name used in error messages (e.g., "trace list")
 * @returns Resolved org and project slugs
 */
export function resolveOrgProjectFromArg(
  target: string | undefined,
  cwd: string,
  commandName: string
): Promise<ResolvedOrgProject> {
  return resolveOrgProjectTarget(parseOrgProjectArg(target), cwd, commandName);
}

// ---------------------------------------------------------------------------
// Multi-target resolution — shared between project-scoped list commands
// ---------------------------------------------------------------------------

/**
 * Result of resolving targets from a parsed org/project argument.
 * Mirrors the shape used by issue list and alert issue list commands.
 */
export type MultiTargetResolutionResult = {
  targets: ResolvedTarget[];
  footer?: string;
  skippedSelfHosted?: number;
  detectedDsns?: DetectedDsn[];
};

/** Options for {@link resolveTargetsFromParsedArg}. */
export type ResolveTargetsOptions = {
  /** Current working directory, for DSN auto-detection. */
  cwd: string;
  /** Usage hint shown in error messages (e.g. "sentry issue list <org>/<project>"). */
  usageHint: string;
  /**
   * Auto-detect mode only: enrich targets that lack a numeric `projectId` by
   * fetching from the project API. Useful when env-var / config-default paths
   * do not carry IDs (needed for issue list query filters, not needed for alert list).
   */
  enrichProjectIds?: boolean;
  /**
   * Project-search mode only: reject inputs that look like issue short IDs
   * (e.g. "CLI-123") before attempting cross-org project search.
   */
  checkIssueShortId?: boolean;
};

/**
 * Resolve one or more {@link ResolvedTarget}s from a parsed org/project argument.
 *
 * Handles all four target modes:
 * - **auto-detect** — DSN detection / config defaults (may resolve multiple projects)
 * - **explicit** — single `org/project` target
 * - **org-all** — all projects in the specified org (trailing slash required)
 * - **project-search** — find a project by slug across all accessible orgs
 *
 * This is the canonical shared implementation used by project-scoped list commands
 * (issue list, alert issue list, …). Pass `opts.enrichProjectIds` or
 * `opts.checkIssueShortId` to enable command-specific behaviour.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inherent multi-mode target resolution with per-mode error handling
export async function resolveTargetsFromParsedArg(
  parsed: ReturnType<typeof parseOrgProjectArg>,
  opts: ResolveTargetsOptions
): Promise<MultiTargetResolutionResult> {
  const { cwd, usageHint, enrichProjectIds, checkIssueShortId } = opts;

  switch (parsed.type) {
    case "auto-detect": {
      const result = await resolveAllTargets({ cwd, usageHint });
      // Only guide when there is genuinely no context. If DSNs WERE found but
      // could not be resolved (self-hosted / no access), `skippedSelfHosted` is
      // set — preserve the empty result so the caller surfaces the
      // inaccessible-DSN error instead of silently resolving a different
      // org/project (which would mask the real problem).
      if (result.targets.length === 0 && !result.skippedSelfHosted) {
        // Offer an interactive picker (TTY) or an actionable error listing the
        // user's accessible orgs, and let a single-org/single-project account
        // resolve automatically (CLI-3B).
        result.targets = [await resolveOrgProjectOrGuide({ cwd, usageHint })];
      }
      if (enrichProjectIds) {
        result.targets = await Promise.all(
          result.targets.map(async (t) => {
            if (t.projectId !== undefined) {
              return t;
            }
            try {
              const info = await getProject(t.org, t.project);
              const id = toNumericId(info.id);
              return id !== undefined ? { ...t, projectId: id } : t;
            } catch (error) {
              logger.debug(
                `Failed to enrich project ID for ${t.org}/${t.project}`,
                error
              );
              return t;
            }
          })
        );
      }
      return result;
    }

    case "explicit": {
      // Resolve DSN-style org identifiers (e.g. "o1081365" → "my-org") before
      // hitting the API, mirroring resolveOrgProjectTarget's explicit branch.
      const org = await resolveEffectiveOrg(parsed.org);
      const projectId = await fetchProjectId(org, parsed.project);
      return {
        targets: [
          {
            org,
            project: parsed.project,
            projectId,
            orgDisplay: org,
            projectDisplay: parsed.project,
          },
        ],
      };
    }

    case "org-all": {
      // Resolve DSN-style org identifiers (e.g. "o1081365" → "my-org") before
      // listing projects, so "o123/" works the same as "my-org/".
      const org = await resolveEffectiveOrg(parsed.org);
      const projects = await listProjects(org);
      const targets: ResolvedTarget[] = projects.map((p) => ({
        org,
        project: p.slug,
        projectId: toNumericId(p.id),
        orgDisplay: org,
        projectDisplay: p.name,
      }));

      if (targets.length === 0) {
        throw new ResolutionError(
          `Organization '${org}'`,
          "has no accessible projects",
          `sentry project list ${org}/`,
          ["Check that you have access to projects in this organization"]
        );
      }

      return {
        targets,
        footer:
          targets.length > 1
            ? `Showing results from ${targets.length} projects in ${org}`
            : undefined,
      };
    }

    case "project-search": {
      const displaySlug = parsed.originalSlug ?? parsed.projectSlug;

      if (
        checkIssueShortId &&
        looksLikeIssueShortId(displaySlug, { ignoreCase: true })
      ) {
        throw new ResolutionError(
          `'${displaySlug}'`,
          "looks like an issue short ID, not a project slug",
          `sentry issue view ${displaySlug}`,
          ["To list issues in a project: sentry issue list <org>/<project>"]
        );
      }

      // When the input is a display name (originalSlug set, contains spaces),
      // skip the slug-based API lookup and go straight to fuzzy matching.
      const isDisplayName = parsed.originalSlug !== undefined;

      // Resolve DSN-style org identifiers before filtering.
      const scopedOrg = parsed.org
        ? await resolveEffectiveOrg(parsed.org)
        : undefined;

      const { projects: rawMatches, orgs: foundOrgs } = isDisplayName
        ? { projects: [], orgs: await listOrganizations() }
        : await findProjectsBySlug(parsed.projectSlug);

      // When the caller provided an org (e.g. "org/My Project"), scope the
      // search to that org instead of all accessible orgs. findProjectsBySlug
      // fans out across every accessible org, so the matched projects must be
      // filtered too — otherwise a slug that also exists in a different org
      // could leak into a result that was explicitly scoped to one org.
      const orgs =
        scopedOrg !== undefined
          ? foundOrgs.filter((o) => o.slug === scopedOrg)
          : foundOrgs;
      const matches =
        scopedOrg !== undefined
          ? rawMatches.filter((m) => m.orgSlug === scopedOrg)
          : rawMatches;

      if (matches.length === 0) {
        const outcome = await triageProjectNotFound(
          parsed.projectSlug,
          orgs,
          parsed.originalSlug
        );

        if (outcome.kind === "org-match") {
          const prefix = usageHint.split(" <")[0];
          throw new ResolutionError(
            `'${parsed.projectSlug}'`,
            "is an organization, not a project",
            `${prefix} ${parsed.projectSlug}/`,
            [
              `List projects: sentry project list ${parsed.projectSlug}/`,
              `Specify a project: ${prefix} ${parsed.projectSlug}/<project>`,
            ]
          );
        }

        if (outcome.kind === "fuzzy-match") {
          const projectId = await fetchProjectId(outcome.org, outcome.project);
          const targets: ResolvedTarget[] = [
            {
              org: outcome.org,
              project: outcome.project,
              projectId,
              orgDisplay: outcome.org,
              projectDisplay: outcome.project,
            },
          ];
          setOrgProjectContext([outcome.org], [outcome.project]);
          return { targets };
        }

        const fallback = scopedOrg
          ? [
              `No project with this name found in organization '${scopedOrg}'`,
              `Check the organization slug or try: sentry project list ${scopedOrg}/`,
            ]
          : ["No project with this slug found in any accessible organization"];
        const suggestions =
          outcome.suggestions.length > 0 ? outcome.suggestions : fallback;
        throw new ResolutionError(
          `Project '${displaySlug}'`,
          "not found",
          "sentry project list",
          suggestions
        );
      }

      const targets: ResolvedTarget[] = matches.map((m) => ({
        org: m.orgSlug,
        project: m.slug,
        projectId: toNumericId(m.id),
        orgDisplay: m.orgSlug,
        projectDisplay: m.name,
      }));

      const uniqueOrgs = [...new Set(targets.map((t) => t.org))];
      const uniqueProjects = [...new Set(targets.map((t) => t.project))];
      setOrgProjectContext(uniqueOrgs, uniqueProjects);

      return {
        targets,
        footer:
          matches.length > 1
            ? `Found '${parsed.projectSlug}' in ${matches.length} organizations`
            : undefined,
      };
    }

    default: {
      const _exhaustive: never = parsed;
      throw new Error(
        `Unexpected parsed type: ${(_exhaustive as { type: string }).type}`
      );
    }
  }
}

/** Resolved org and optional project — used by commands that accept org-all mode. */
export type ResolvedOrgOptionalProject = {
  /** Organization slug */
  org: string;
  /** Project slug (absent in org-all and auto-detect modes) */
  project?: string;
  /** Full project data when resolved via project-search (avoids redundant re-fetch) */
  projectData?: SentryProject;
};

/**
 * Resolve an org/project target for commands that accept org-all mode
 * (e.g., `sentry explore`). Unlike {@link resolveOrgProjectTarget}, this
 * function allows `org-all` and `auto-detect` modes to resolve to an
 * org-only result without requiring a project.
 *
 * Handles:
 * - explicit `<org>/<project>` → delegate to {@link resolveOrgProjectTarget}
 * - project-search `<project>` → delegate to {@link resolveOrgProjectTarget}
 * - org-all `<org>/` → resolve the org slug only
 * - auto-detect → resolve org only (no project required)
 *
 * @param parsed - Parsed org/project argument
 * @param cwd - Current working directory for DSN auto-detection
 * @param commandName - Command name used in error messages (e.g., "explore")
 * @returns Resolved org and optional project slugs
 * @throws {ContextError} When target cannot be resolved
 */
export async function resolveOrgOptionalProjectTarget(
  parsed: ParsedOrgProject,
  cwd: string,
  commandName: string
): Promise<ResolvedOrgOptionalProject> {
  // org-all: resolve the org slug only
  if (parsed.type === "org-all") {
    const org = await resolveEffectiveOrg(parsed.org);
    return withTelemetryContext({ org });
  }

  // auto-detect: resolve org only (no project required)
  if (parsed.type === "auto-detect") {
    const resolved = await resolveOrg({ cwd });
    if (!resolved) {
      throw new ContextError("Organization", `sentry ${commandName} <target>`, [
        "SENTRY_ORG environment variable",
        "sentry cli defaults",
      ]);
    }
    return withTelemetryContext({ org: resolved.org });
  }

  // explicit and project-search: delegate to the project-required resolver
  return resolveOrgProjectTarget(parsed, cwd, commandName);
}

/**
 * Resolve an org/project target from a raw CLI argument string for commands
 * that accept org-all mode (e.g., `sentry explore`).
 *
 * Convenience wrapper around `resolveOrgOptionalProjectTarget` that also calls
 * `parseOrgProjectArg` on the raw string argument.
 *
 * @param target - Raw CLI argument string (or undefined for auto-detect)
 * @param cwd - Current working directory for DSN auto-detection
 * @param commandName - Command name used in error messages (e.g., "explore")
 * @returns Resolved org and optional project slugs
 */
export function resolveOrgOptionalProjectFromArg(
  target: string | undefined,
  cwd: string,
  commandName: string
): Promise<ResolvedOrgOptionalProject> {
  return resolveOrgOptionalProjectTarget(
    parseOrgProjectArg(target),
    cwd,
    commandName
  );
}
