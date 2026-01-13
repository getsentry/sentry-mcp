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
import { getCachedProject, getDefaultOrganization } from "../../lib/config.js";
import { detectDsn } from "../../lib/dsn-detector.js";
import {
  formatEventDetails,
  formatIssueDetails,
} from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import type { SentryEvent, SentryIssue } from "../../types/index.js";

type GetFlags = {
  readonly org?: string;
  readonly json: boolean;
  readonly event: boolean;
};

/**
 * Try to fetch the latest event for an issue
 */
async function tryGetLatestEvent(
  issueId: string
): Promise<SentryEvent | undefined> {
  try {
    return await getLatestEvent(issueId);
  } catch {
    // Event fetch might fail, continue without it
    return;
  }
}

/**
 * Resolve organization from various sources for short ID lookup
 */
async function resolveOrg(
  flagOrg: string | undefined,
  cwd: string
): Promise<string | null> {
  // 1. Check CLI flag
  if (flagOrg) {
    return flagOrg;
  }

  // 2. Check config defaults
  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return defaultOrg;
  }

  // 3. Try DSN auto-detection
  try {
    const dsn = await detectDsn(cwd);
    if (dsn?.orgId) {
      // Check cache for org slug
      const cached = await getCachedProject(dsn.orgId, dsn.projectId);
      if (cached) {
        return cached.orgSlug;
      }
      // Fall back to numeric org ID (API accepts both)
      return dsn.orgId;
    }
  } catch {
    // Detection failed
  }

  return null;
}

/**
 * Write human-readable issue output
 */
function writeHumanOutput(
  stdout: NodeJS.WriteStream,
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
      "Use --event to also fetch the latest event details.\n\n" +
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
      event: {
        kind: "boolean",
        brief: "Also fetch the latest event",
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
    const { stdout, stderr } = process;

    try {
      let issue: SentryIssue;

      // Check if it's a short ID (contains letters) vs numeric ID
      if (isShortId(issueId)) {
        // Short ID requires organization context
        const org = await resolveOrg(flags.org, cwd);
        if (!org) {
          stderr.write(
            "Error: Organization is required for short ID lookup.\n\n" +
              "Please specify it using:\n" +
              `  sentry issue get ${issueId} --org <org-slug>\n\n` +
              "Or set SENTRY_DSN environment variable for automatic detection.\n"
          );
          process.exitCode = 1;
          return;
        }
        issue = await getIssueByShortId(org, issueId);
      } else {
        // Numeric ID can be fetched directly
        issue = await getIssue(issueId);
      }

      const event = flags.event ? await tryGetLatestEvent(issue.id) : undefined;

      if (flags.json) {
        const output = event ? { issue, event } : { issue };
        writeJson(stdout, output);
        return;
      }

      writeHumanOutput(stdout, issue, event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Error fetching issue: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
