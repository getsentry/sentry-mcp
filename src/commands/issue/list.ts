/**
 * sentry issue list
 *
 * List issues from a Sentry project.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import {
  listIssues,
  listOrganizations,
  listProjects,
} from "../../lib/api-client.js";
import { divider, formatIssueRow } from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import type { SentryIssue } from "../../types/index.js";

type ListFlags = {
  readonly org?: string;
  readonly project?: string;
  readonly query?: string;
  readonly limit: number;
  readonly sort: "date" | "new" | "priority" | "freq" | "user";
  readonly json: boolean;
};

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
 * Write the issue list header with column titles.
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
 * Write formatted issue rows to stdout.
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
 * Write footer with usage tip.
 */
function writeListFooter(stdout: NodeJS.WriteStream): void {
  stdout.write(
    "\nTip: Use 'sentry issue get <SHORT_ID>' to view issue details.\n"
  );
}

/** Minimal project reference for error message display */
type ProjectRef = {
  orgSlug: string;
  projectSlug: string;
};

/**
 * Fetch all projects from all accessible organizations.
 * Used to show available options when no project is specified.
 *
 * @returns List of org/project slug pairs
 */
async function fetchAllProjects(): Promise<ProjectRef[]> {
  const orgs = await listOrganizations();
  const results: ProjectRef[] = [];

  for (const org of orgs) {
    try {
      const projects = await listProjects(org.slug);
      for (const project of projects) {
        results.push({
          orgSlug: org.slug,
          projectSlug: project.slug,
        });
      }
    } catch {
      // User may lack access to some orgs
    }
  }

  return results;
}

/**
 * Build a helpful error message listing all available projects.
 * Fetches projects from all accessible organizations.
 *
 * @returns Formatted error message with project list and usage instructions
 */
async function buildNoProjectError(): Promise<string> {
  const projects = await fetchAllProjects();

  const lines: string[] = ["No project specified.", ""];

  if (projects.length > 0) {
    lines.push("Available projects:");
    lines.push("");
    for (const p of projects) {
      lines.push(`  ${p.orgSlug}/${p.projectSlug}`);
    }
    lines.push("");
  }

  lines.push("Specify a project using:");
  lines.push("  sentry issue list --org <org-slug> --project <project-slug>");
  lines.push("");
  lines.push("Or set SENTRY_DSN in your environment for automatic detection.");

  return lines.join("\n");
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

    const target = await resolveOrgAndProject({
      org: flags.org,
      project: flags.project,
      cwd,
    });

    if (!target) {
      const errorMessage = await buildNoProjectError();
      throw new Error(errorMessage);
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
