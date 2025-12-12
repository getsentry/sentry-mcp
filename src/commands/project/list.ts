/**
 * sry project list
 *
 * List projects in an organization.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { listOrganizations, listProjects } from "../../lib/api-client.js";
import { getDefaultOrganization } from "../../lib/config.js";
import {
  calculateProjectSlugWidth,
  formatProjectRow,
} from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import type { SentryProject } from "../../types/index.js";

type ListFlags = {
  readonly org?: string;
  readonly limit: number;
  readonly json: boolean;
  readonly platform?: string;
};

type ProjectWithOrg = SentryProject & { orgSlug?: string };

/**
 * Fetch projects for a single organization
 */
async function fetchOrgProjects(orgSlug: string): Promise<ProjectWithOrg[]> {
  const projects = await listProjects(orgSlug);
  return projects.map((p) => ({ ...p, orgSlug }));
}

/**
 * Fetch projects from all accessible organizations
 */
async function fetchAllOrgProjects(): Promise<ProjectWithOrg[]> {
  const orgs = await listOrganizations();
  const results: ProjectWithOrg[] = [];

  for (const org of orgs) {
    try {
      const projects = await fetchOrgProjects(org.slug);
      results.push(...projects);
    } catch {
      // Skip orgs we can't access
    }
  }

  return results;
}

/**
 * Filter projects by platform
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
 * Write project list header
 */
function writeHeader(stdout: NodeJS.WriteStream, slugWidth: number): void {
  stdout.write(`${"SLUG".padEnd(slugWidth)}  ${"PLATFORM".padEnd(20)}  NAME\n`);
}

/**
 * Write project rows
 */
function writeRows(
  stdout: NodeJS.WriteStream,
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

export const listCommand = buildCommand({
  docs: {
    brief: "List projects",
    fullDescription:
      "List projects in an organization. If no organization is specified, " +
      "uses the default organization or lists projects from all accessible organizations.\n\n" +
      "Examples:\n" +
      "  sry project list\n" +
      "  sry project list --org my-org\n" +
      "  sry project list --limit 10\n" +
      "  sry project list --json\n" +
      "  sry project list --platform javascript",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Organization slug (optional)",
          parse: String,
          optional: true,
        },
      ],
    },
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
  async func(
    this: SryContext,
    flags: ListFlags,
    orgArg?: string
  ): Promise<void> {
    const { process } = this;
    const { stdout, stderr } = process;

    try {
      const orgSlug = orgArg ?? flags.org ?? getDefaultOrganization();
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
        stdout.write(
          `\nShowing ${flags.limit} of ${filtered.length} projects\n`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Error listing projects: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
