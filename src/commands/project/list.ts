/**
 * sentry project list
 *
 * List projects in an organization.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { listOrganizations, listProjects } from "../../lib/api-client.js";
import { getCachedProject, getDefaultOrganization } from "../../lib/config.js";
import { detectDsn, getDsnSourceDescription } from "../../lib/dsn/index.js";
import {
  calculateProjectSlugWidth,
  formatProjectRow,
  writeJson,
} from "../../lib/formatters/index.js";
import type { SentryProject, Writer } from "../../types/index.js";

type ListFlags = {
  readonly org?: string;
  readonly limit: number;
  readonly json: boolean;
  readonly platform?: string;
};

/** Project with its organization context for display */
type ProjectWithOrg = SentryProject & { orgSlug?: string };

/**
 * Fetch projects for a single organization.
 *
 * @param orgSlug - Organization slug to fetch projects from
 * @returns Projects with org context attached
 */
async function fetchOrgProjects(orgSlug: string): Promise<ProjectWithOrg[]> {
  const projects = await listProjects(orgSlug);
  return projects.map((p) => ({ ...p, orgSlug }));
}

/**
 * Fetch projects from all accessible organizations.
 * Skips orgs where the user lacks access.
 *
 * @returns Combined list of projects from all accessible orgs
 */
async function fetchAllOrgProjects(): Promise<ProjectWithOrg[]> {
  const orgs = await listOrganizations();
  const results: ProjectWithOrg[] = [];

  for (const org of orgs) {
    try {
      const projects = await fetchOrgProjects(org.slug);
      results.push(...projects);
    } catch {
      // User may lack access to some orgs
    }
  }

  return results;
}

/**
 * Filter projects by platform name (case-insensitive partial match).
 *
 * @param projects - Projects to filter
 * @param platform - Platform substring to match (e.g., "javascript", "python")
 * @returns Filtered projects, or all projects if no platform specified
 */
function filterByPlatform(
  projects: ProjectWithOrg[],
  platform?: string
): ProjectWithOrg[] {
  if (!platform) {
    return projects;
  }
  const lowerPlatform = platform.toLowerCase();
  return projects.filter((p) =>
    p.platform?.toLowerCase().includes(lowerPlatform)
  );
}

/**
 * Write the column header row for project list output.
 */
function writeHeader(stdout: Writer, slugWidth: number): void {
  stdout.write(`${"SLUG".padEnd(slugWidth)}  ${"PLATFORM".padEnd(20)}  NAME\n`);
}

/**
 * Write formatted project rows to stdout.
 */
function writeRows(
  stdout: Writer,
  projects: ProjectWithOrg[],
  slugWidth: number,
  showOrg: boolean
): void {
  for (const project of projects) {
    stdout.write(
      `${formatProjectRow(project, { showOrg, orgSlug: project.orgSlug, slugWidth })}\n`
    );
  }
}

/** Result of resolving organization from DSN detection */
type DsnOrgResult = {
  orgSlug: string;
  detectedFrom: string;
};

/**
 * Attempt to resolve organization slug from DSN in the current directory.
 * Uses cached project info when available to get the org slug.
 *
 * @param cwd - Current working directory to search for DSN
 * @returns Org slug and detection source, or null if not found
 */
async function resolveOrgFromDsn(cwd: string): Promise<DsnOrgResult | null> {
  const dsn = await detectDsn(cwd);
  if (!dsn?.orgId) {
    return null;
  }

  // Prefer cached org slug over numeric ID for better display
  const cached = await getCachedProject(dsn.orgId, dsn.projectId);
  const orgSlug = cached?.orgSlug ?? dsn.orgId;

  return {
    orgSlug,
    detectedFrom: getDsnSourceDescription(dsn),
  };
}

export const listCommand = buildCommand({
  docs: {
    brief: "List projects",
    fullDescription:
      "List projects in an organization. If no organization is specified, " +
      "uses the default organization or lists projects from all accessible organizations.\n\n" +
      "Examples:\n" +
      "  sentry project list\n" +
      "  sentry project list --org my-org\n" +
      "  sentry project list --limit 10\n" +
      "  sentry project list --json\n" +
      "  sentry project list --platform javascript",
  },
  parameters: {
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of projects to list",
        default: 30,
      },
      json: {
        kind: "boolean",
        brief: "Output JSON",
        default: false,
      },
      platform: {
        kind: "parsed",
        parse: String,
        brief: "Filter by platform (e.g., javascript, python)",
        optional: true,
      },
    },
  },
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { stdout, cwd } = this;

    // Resolve organization from multiple sources
    let orgSlug = flags.org ?? (await getDefaultOrganization());
    let detectedFrom: string | undefined;

    // Try DSN auto-detection if no org specified
    if (!orgSlug) {
      const dsnResult = await resolveOrgFromDsn(cwd).catch(() => null);
      if (dsnResult) {
        orgSlug = dsnResult.orgSlug;
        detectedFrom = dsnResult.detectedFrom;
      }
    }

    const showOrg = !orgSlug;

    // Fetch projects
    let allProjects: ProjectWithOrg[];
    if (orgSlug) {
      allProjects = await fetchOrgProjects(orgSlug);
    } else {
      allProjects = await fetchAllOrgProjects();
    }

    // Filter and limit
    const filtered = filterByPlatform(allProjects, flags.platform);
    const limited = filtered.slice(0, flags.limit);

    if (flags.json) {
      writeJson(stdout, limited);
      return;
    }

    if (limited.length === 0) {
      const msg = orgSlug
        ? `No projects found in organization '${orgSlug}'.\n`
        : "No projects found.\n";
      stdout.write(msg);
      return;
    }

    const slugWidth = calculateProjectSlugWidth(limited, showOrg);

    writeHeader(stdout, slugWidth);
    writeRows(stdout, limited, slugWidth, showOrg);

    if (filtered.length > flags.limit) {
      stdout.write(`\nShowing ${flags.limit} of ${filtered.length} projects\n`);
    }

    // Show detection source and hint if auto-detected
    if (detectedFrom) {
      stdout.write(`\nDetected from ${detectedFrom}\n`);
      stdout.write("Use --org to see projects from other organizations.\n");
    }
  },
});
