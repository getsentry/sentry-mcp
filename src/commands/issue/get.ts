/**
 * sentry issue get
 *
 * Get detailed information about a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import {
  getIssue,
  getIssueByShortId,
  getLatestEvent,
  isShortId,
} from "../../lib/api-client.js";
import {
  formatEventDetails,
  formatIssueDetails,
} from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import type { SentryEvent, SentryIssue } from "../../types/index.js";

type GetFlags = {
  readonly org?: string;
  readonly json: boolean;
};

/**
 * Try to fetch the latest event for an issue.
 * Returns undefined if the fetch fails (non-blocking).
 */
async function tryGetLatestEvent(
  issueId: string
): Promise<SentryEvent | undefined> {
  try {
    return await getLatestEvent(issueId);
  } catch {
    return;
  }
}

/**
 * Write human-readable issue output
 */
function writeHumanOutput(
  stdout: Writer,
  issue: SentryIssue,
  event?: SentryEvent
): void {
  const issueLines = formatIssueDetails(issue);
  stdout.write(`${issueLines.join("\n")}\n`);

  if (event) {
    const eventLines = formatEventDetails(event);
    stdout.write(`${eventLines.join("\n")}\n`);
  }
}

export const getCommand = buildCommand({
  docs: {
    brief: "Get details of a specific issue",
    fullDescription:
      "Retrieve detailed information about a Sentry issue by its ID or short ID. " +
      "The latest event is automatically included for full context.\n\n" +
      "For short IDs (e.g., SPOTLIGHT-ELECTRON-4D), the organization is resolved from:\n" +
      "  1. --org flag\n" +
      "  2. Config defaults\n" +
      "  3. SENTRY_DSN environment variable",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Issue ID or short ID (e.g., JAVASCRIPT-ABC or 123456)",
          parse: String,
        },
      ],
    },
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief:
          "Organization slug (required for short IDs if not auto-detected)",
        optional: true,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(
    this: SentryContext,
    flags: GetFlags,
    issueId: string
  ): Promise<void> {
    const { process, cwd } = this;
    const { stdout } = process;

    let issue: SentryIssue;

    // Check if it's a short ID (contains letters) vs numeric ID
    if (isShortId(issueId)) {
      // Short ID requires organization context
      const resolved = await resolveOrg({ org: flags.org, cwd });
      if (!resolved) {
        throw new Error(
          "Organization is required for short ID lookup.\n\n" +
            "Please specify it using:\n" +
            `  sentry issue get ${issueId} --org <org-slug>\n\n` +
            "Or set SENTRY_DSN environment variable for automatic detection."
        );
      }
      issue = await getIssueByShortId(resolved.org, issueId);
    } else {
      // Numeric ID can be fetched directly
      issue = await getIssue(issueId);
    }

    // Always fetch the latest event for full context
    const event = await tryGetLatestEvent(issue.id);

    if (flags.json) {
      const output = event ? { issue, event } : { issue };
      writeJson(stdout, output);
      return;
    }

    writeHumanOutput(stdout, issue, event);
  },
});
