/**
 * Target Resolution
 *
 * Shared utilities for resolving organization and project context from
 * various sources: CLI flags, config defaults, and DSN detection.
 *
 * Resolution priority (highest to lowest):
 * 1. Explicit CLI flags
 * 2. Config defaults
 * 3. DSN auto-detection (source code, .env files, environment variables)
 */

import { getProject } from "./api-client.js";
import {
  getCachedProject,
  getDefaultOrganization,
  getDefaultProject,
  setCachedProject,
} from "./config.js";
import { detectDsn, getDsnSourceDescription } from "./dsn/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolved organization and project target for API calls.
 */
export type ResolvedTarget = {
  /** Organization slug for API calls */
  org: string;
  /** Project slug for API calls */
  project: string;
  /** Human-readable org name (falls back to slug) */
  orgDisplay: string;
  /** Human-readable project name (falls back to slug) */
  projectDisplay: string;
  /** Source description if auto-detected (e.g., ".env.local", "src/index.ts") */
  detectedFrom?: string;
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
  /** Organization slug from CLI flag */
  org?: string;
  /** Project slug from CLI flag */
  project?: string;
  /** Current working directory for DSN detection */
  cwd: string;
};

/**
 * Options for resolving org only.
 */
export type ResolveOrgOptions = {
  /** Organization slug from CLI flag */
  org?: string;
  /** Current working directory for DSN detection */
  cwd: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// DSN-based Resolution
// ─────────────────────────────────────────────────────────────────────────────

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
  const cached = await getCachedProject(dsn.orgId, dsn.projectId);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
    };
  }

  // Cache miss — fetch project details and cache them
  const projectInfo = await getProject(dsn.orgId, dsn.projectId);

  if (projectInfo.organization) {
    await setCachedProject(dsn.orgId, dsn.projectId, {
      orgSlug: projectInfo.organization.slug,
      orgName: projectInfo.organization.name,
      projectSlug: projectInfo.slug,
      projectName: projectInfo.name,
    });

    return {
      org: projectInfo.organization.slug,
      project: projectInfo.slug,
      orgDisplay: projectInfo.organization.name,
      projectDisplay: projectInfo.name,
      detectedFrom,
    };
  }

  // Fallback to numeric IDs if org info missing (rare edge case)
  return {
    org: dsn.orgId,
    project: dsn.projectId,
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
    const cached = await getCachedProject(dsn.orgId, dsn.projectId);
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

// ─────────────────────────────────────────────────────────────────────────────
// Full Resolution Chain
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve organization and project from multiple sources.
 *
 * Resolution priority:
 * 1. CLI flags (--org and --project) - both must be provided together
 * 2. Config defaults
 * 3. DSN auto-detection
 *
 * @param options - Resolution options with flags and cwd
 * @returns Resolved target, or null if resolution failed
 * @throws Error if only one of org/project flags is provided
 */
export async function resolveOrgAndProject(
  options: ResolveOptions
): Promise<ResolvedTarget | null> {
  const { org, project, cwd } = options;

  // 1. CLI flags take priority (both must be provided together)
  if (org && project) {
    return {
      org,
      project,
      orgDisplay: org,
      projectDisplay: project,
    };
  }

  // Error if only one flag is provided
  if (org || project) {
    const missing = org ? "--project" : "--org";
    const provided = org ? "--org" : "--project";
    throw new Error(
      `${provided} was specified but ${missing} is also required.\n` +
        "Please provide both --org and --project flags together."
    );
  }

  // 2. Config defaults
  const defaultOrg = await getDefaultOrganization();
  const defaultProject = await getDefaultProject();
  if (defaultOrg && defaultProject) {
    return {
      org: defaultOrg,
      project: defaultProject,
      orgDisplay: defaultOrg,
      projectDisplay: defaultProject,
    };
  }

  // 3. DSN auto-detection
  try {
    return await resolveFromDsn(cwd);
  } catch {
    return null;
  }
}

/**
 * Resolve organization only from multiple sources.
 *
 * Resolution priority:
 * 1. CLI flag (--org)
 * 2. Config defaults
 * 3. DSN auto-detection
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
    return { org };
  }

  // 2. Config defaults
  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return { org: defaultOrg };
  }

  // 3. DSN auto-detection
  try {
    return await resolveOrgFromDsn(cwd);
  } catch {
    return null;
  }
}
