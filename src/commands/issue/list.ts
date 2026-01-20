/**
 * sentry issue list
 *
 * List issues from a Sentry project.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { listIssues } from "../../lib/api-client.js";
import { ContextError } from "../../lib/errors.js";
import {
  divider,
  formatIssueRow,
  info,
  muted,
  writeJson,
} from "../../lib/formatters/index.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import type { SentryIssue, Writer } from "../../types/index.js";

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
  stdout: Writer,
  org: string,
  project: string,
  count: number
): void {
  stdout.write(`Issues in ${org}/${project} (showing ${count}):\n\n`);
  stdout.write(muted("● LEVEL   SHORT ID         COUNT  TITLE\n"));
  stdout.write(`${divider(80)}\n`);
}

/**
 * Write formatted issue rows to stdout.
 */
function writeIssueRows(stdout: Writer, issues: SentryIssue[]): void {
  for (const issue of issues) {
    stdout.write(`${formatIssueRow(issue)}\n`);
  }
}

/**
 * Write footer with usage tip.
 */
function writeListFooter(stdout: Writer): void {
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
        // Stricli requires string defaults (raw CLI input); numberParser converts to number
        default: "25",
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
    const { stdout, cwd } = this;

    const target = await resolveOrgAndProject({
      org: flags.org,
      project: flags.project,
      cwd,
    });

    if (!target) {
      throw new ContextError(
        "Organization and project",
        "sentry issue list --org <org-slug> --project <project-slug>"
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
        stdout.write(`\n${info("ℹ")} Detected from ${target.detectedFrom}\n`);
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
      stdout.write(`\n${info("ℹ")} Detected from ${target.detectedFrom}\n`);
    }
  },
});
