/**
 * sentry issue list
 *
 * List issues from a Sentry project.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getProject, listIssues } from "../../lib/api-client.js";
import {
  getCachedProject,
  getDefaultOrganization,
  getDefaultProject,
  setCachedProject,
} from "../../lib/config.js";
import { detectDsn, getDsnSourceDescription } from "../../lib/dsn-detector.js";
import { divider, formatIssueRow } from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import type { SentryIssue } from "../../types/index.js";

type ListFlags = {
  readonly org?: string;
  readonly project?: string;
  readonly query?: string;
  readonly limit: number;
  readonly sort: "date" | "new" | "priority" | "freq" | "user";
  readonly json: boolean;
};

/**
 * Result of resolving org and project
 */
type ResolvedTarget = {
  org: string;
  project: string;
  /** Display name for org (slug or name) */
  orgDisplay: string;
  /** Display name for project (slug or name) */
  projectDisplay: string;
  /** Source description if auto-detected */
  detectedFrom?: string;
};

/**
 * Resolve org and project from DSN with caching
 */
async function resolveFromDsn(cwd: string): Promise<ResolvedTarget | null> {
  const dsn = await detectDsn(cwd);
  if (!(dsn?.orgId && dsn.projectId)) {
    return null;
  }

  // Check cache first
  const cached = await getCachedProject(dsn.orgId, dsn.projectId);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom: getDsnSourceDescription(dsn),
    };
  }

  // Cache miss - fetch project details
  const projectInfo = await getProject(dsn.orgId, dsn.projectId);

  // Cache the result
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
      detectedFrom: getDsnSourceDescription(dsn),
    };
  }

  // Fallback if org info not in response (shouldn't happen)
  return {
    org: dsn.orgId,
    project: dsn.projectId,
    orgDisplay: dsn.orgId,
    projectDisplay: projectInfo.name,
    detectedFrom: getDsnSourceDescription(dsn),
  };
}

type SortValue = "date" | "new" | "priority" | "freq" | "user";

const VALID_SORT_VALUES: SortValue[] = [
  "date",
  "new",
  "priority",
  "freq",
  "user",
];

function parseSort(value: string): SortValue {
  if (!VALID_SORT_VALUES.includes(value as SortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SortValue;
}

/**
 * Write issue list header
 */
function writeListHeader(
  stdout: NodeJS.WriteStream,
  org: string,
  project: string,
  count: number
): void {
  stdout.write(`Issues in ${org}/${project} (showing ${count}):\n\n`);
  stdout.write("  STATUS  SHORT ID         COUNT  TITLE\n");
  stdout.write(`${divider(80)}\n`);
}

/**
 * Write issue list rows
 */
function writeIssueRows(
  stdout: NodeJS.WriteStream,
  issues: SentryIssue[]
): void {
  for (const issue of issues) {
    stdout.write(`${formatIssueRow(issue)}\n`);
  }
}

/**
 * Write list footer with tip
 */
function writeListFooter(stdout: NodeJS.WriteStream): void {
  stdout.write(
    "\nTip: Use 'sentry issue get <SHORT_ID>' to view issue details.\n"
  );
}

export const listCommand = buildCommand({
  docs: {
    brief: "List issues in a project",
    fullDescription:
      "List issues from a Sentry project. Use --org and --project to specify " +
      "the target, or set defaults with 'sentry config set'.",
  },
  parameters: {
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
      project: {
        kind: "parsed",
        parse: String,
        brief: "Project slug",
        optional: true,
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Search query (Sentry search syntax)",
        optional: true,
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of issues to return",
        default: 25,
      },
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief: "Sort by: date, new, priority, freq, user",
        default: "date" as const,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { process, cwd } = this;
    const { stdout } = process;

    // Resolve organization and project
    let target: ResolvedTarget | null = null;

    // 1. Check CLI flags
    if (flags.org && flags.project) {
      target = {
        org: flags.org,
        project: flags.project,
        orgDisplay: flags.org,
        projectDisplay: flags.project,
      };
    }

    // 2. Check config defaults
    if (!target) {
      const defaultOrg = await getDefaultOrganization();
      const defaultProject = await getDefaultProject();
      if (defaultOrg && defaultProject) {
        target = {
          org: defaultOrg,
          project: defaultProject,
          orgDisplay: defaultOrg,
          projectDisplay: defaultProject,
        };
      }
    }

    // 3. Try DSN auto-detection
    if (!target) {
      try {
        target = await resolveFromDsn(cwd);
      } catch {
        // DSN detection failed, continue to show error
      }
    }

    if (!target) {
      throw new Error(
        "Organization and project are required.\n\n" +
          "Please specify them using:\n" +
          "  sentry issue list --org <org-slug> --project <project-slug>\n\n" +
          "Or set defaults:\n" +
          "  sentry config set defaults.organization <org-slug>\n" +
          "  sentry config set defaults.project <project-slug>\n\n" +
          "Or set SENTRY_DSN environment variable for automatic detection."
      );
    }

    const issues = await listIssues(target.org, target.project, {
      query: flags.query,
      limit: flags.limit,
      sort: flags.sort,
    });

    if (flags.json) {
      writeJson(stdout, issues);
      return;
    }

    if (issues.length === 0) {
      stdout.write("No issues found.\n");
      if (target.detectedFrom) {
        stdout.write(`\nℹ Detected from ${target.detectedFrom}\n`);
      }
      return;
    }

    writeListHeader(
      stdout,
      target.orgDisplay,
      target.projectDisplay,
      issues.length
    );
    writeIssueRows(stdout, issues);
    writeListFooter(stdout);

    // Show detection source if auto-detected
    if (target.detectedFrom) {
      stdout.write(`\nℹ Detected from ${target.detectedFrom}\n`);
    }
  },
});
