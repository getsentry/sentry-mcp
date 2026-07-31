/**
 * sentry issue view
 *
 * View detailed information about a Sentry issue.
 */

import type { SentryContext } from "../../context.js";
import { getLatestEvent, listReplayIdsForIssue } from "../../lib/api-client.js";
import { spansFlag } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import {
  formatEventDetails,
  formatIssueDetails,
  isPlainOutput,
  muted,
  renderMarkdown,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import {
  collectReplayIds,
  getReplayIdFromEvent,
} from "../../lib/replay-search.js";
import { getSpanTreeLines } from "../../lib/span-tree.js";
import type { SentryEvent, SentryIssue } from "../../types/index.js";
import { IssueViewOutputSchema } from "../../types/index.js";
import { issueIdPositional, resolveIssue } from "./utils.js";

const log = logger.withTag("issue.view");

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly spans: number;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/**
 * Try to fetch the latest event for an issue.
 * Returns undefined if the fetch fails (non-blocking).
 *
 * @param orgSlug - Organization slug for API routing
 * @param issueId - Issue ID (numeric)
 */
async function tryGetLatestEvent(
  orgSlug: string,
  issueId: string
): Promise<SentryEvent | undefined> {
  try {
    return await getLatestEvent(orgSlug, issueId);
  } catch (error) {
    log.debug("Failed to fetch latest event for issue", error);
    return;
  }
}

/**
 * Try to fetch replay IDs related to an issue.
 * Returns an empty array if the fetch fails (non-blocking).
 */
async function tryListReplayIdsForIssue(
  orgSlug: string,
  issueId: string
): Promise<string[]> {
  try {
    return await listReplayIdsForIssue(orgSlug, issueId);
  } catch (error) {
    log.debug("Failed to fetch replay IDs for issue", error);
    return [];
  }
}

/** Return type for issue view — includes all data both renderers need */
type IssueViewData = {
  org: string | null;
  issue: SentryIssue;
  event: SentryEvent | null;
  replayIds: string[];
  trace: { traceId: string; spans: unknown[] } | null;
  /** Pre-formatted span tree lines for human output (not serialized) */
  spanTreeLines?: string[];
};

const MAX_REPLAY_IDS_SHOWN = 3;

function formatReplaySection(org: string | null, replayIds: string[]): string {
  if (replayIds.length === 0) {
    return "";
  }

  const visibleReplayIds = replayIds.slice(0, MAX_REPLAY_IDS_SHOWN);
  const lines = ["### Related Replays", ""];

  for (const replayId of visibleReplayIds) {
    if (org) {
      lines.push(
        `- \`${replayId}\` (view: \`sentry replay view ${org}/${replayId}\`)`
      );
    } else {
      lines.push(`- \`${replayId}\``);
    }
  }

  const remainingCount = replayIds.length - visibleReplayIds.length;
  if (remainingCount > 0) {
    lines.push(
      `- ${remainingCount} more related replay${remainingCount === 1 ? "" : "s"}`
    );
  }

  return renderMarkdown(lines.join("\n"));
}

/**
 * Format issue view data for human-readable terminal output.
 *
 * Renders issue details, optional latest event, and optional span tree.
 */
function formatIssueView(data: IssueViewData): string {
  const parts: string[] = [];
  const eventReplayId = data.event
    ? getReplayIdFromEvent(data.event)
    : undefined;

  parts.push(formatIssueDetails(data.issue));

  if (data.event) {
    parts.push(
      formatEventDetails(data.event, "Latest Event", data.issue.permalink)
    );
  }

  const additionalReplayIds = eventReplayId
    ? data.replayIds.filter((replayId) => replayId !== eventReplayId)
    : data.replayIds;
  const replaySection = formatReplaySection(data.org, additionalReplayIds);
  if (replaySection) {
    parts.push(replaySection);
  }

  if (data.spanTreeLines && data.spanTreeLines.length > 0) {
    parts.push(data.spanTreeLines.join("\n"));
  }

  return parts.join("\n");
}

/**
 * Transform issue view data for JSON output.
 *
 * Flattens the issue as the primary object so that `--fields shortId,title`
 * works directly on issue properties. The `event`, `trace`, `org`, and
 * `replayIds` enrichment data are attached as sibling keys, accessible via
 * `--fields event.id`, `--fields trace.traceId`, or `--fields replayIds`.
 *
 * Without this transform, `--fields shortId` would return `{}` because
 * the raw yield shape is `{ issue, event, trace }` and `shortId` lives
 * inside `issue`.
 */
function jsonTransformIssueView(
  data: IssueViewData,
  fields?: string[]
): unknown {
  const { issue, event, org, replayIds, trace } = data;
  const result: Record<string, unknown> = {
    ...issue,
    event,
    org,
    replayIds,
    trace,
  };
  if (fields && fields.length > 0) {
    return filterFields(result, fields);
  }
  return result;
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a specific issue",
    fullDescription:
      "View detailed information about a Sentry issue by its ID or short ID. " +
      "The latest event is automatically included for full context.\n\n" +
      "Issue formats:\n" +
      "  @latest         - Most recent unresolved issue\n" +
      "  @most_frequent  - Issue with highest event frequency\n" +
      "  <org>/ID        - Explicit org: sentry/EXTENSION-7, sentry/cli-G\n" +
      "  <org>/@selector - Selector with org: my-org/@latest\n" +
      "  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y\n" +
      "  ID              - Short ID: CLI-G (searches across orgs)\n" +
      "  suffix          - Suffix only: G (requires DSN context)\n" +
      "  numeric         - Numeric ID: 123456789\n" +
      "  org/project#ID  - GitHub-style: my-org/my-project#PROJ-123\n\n" +
      "In multi-project mode (after 'issue list'), use alias-suffix format (e.g., 'f-g' " +
      "where 'f' is the project alias shown in the list).",
  },
  output: {
    human: formatIssueView,
    jsonTransform: jsonTransformIssueView,
    schema: IssueViewOutputSchema,
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      ...spansFlag,
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES, w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, issueArg: string) {
    applyFreshFlag(flags);
    const { cwd } = this;

    // Resolve issue using shared resolution logic
    const { org: orgSlug, issue } = await resolveIssue({
      issueArg,
      cwd,
      command: "view",
    });

    if (flags.web) {
      await openInBrowser(issue.permalink, "issue");
      return;
    }

    // Fetch the latest event for full context (requires org slug)
    const [event, relatedReplayIds] = orgSlug
      ? await Promise.all([
          tryGetLatestEvent(orgSlug, issue.id),
          tryListReplayIdsForIssue(orgSlug, issue.id),
        ])
      : [undefined, []];
    const replayIds = collectReplayIds([
      event ? getReplayIdFromEvent(event) : undefined,
      ...relatedReplayIds,
    ]);

    // Fetch span tree data (for both JSON and human output)
    // Skip when spans=0 (disabled via --spans no or --spans 0)
    let spanTreeResult:
      | Awaited<ReturnType<typeof getSpanTreeLines>>
      | undefined;
    if (orgSlug && event && flags.spans > 0) {
      spanTreeResult = await getSpanTreeLines(orgSlug, event, flags.spans);
    }

    // Prepare span tree lines for human output
    let spanTreeLines: string[] | undefined;
    if (spanTreeResult) {
      spanTreeLines = spanTreeResult.lines;
    } else if (!orgSlug) {
      const msg = "\nOrganization context required to fetch span tree.";
      spanTreeLines = [isPlainOutput() ? msg : muted(msg)];
    } else if (!event) {
      const msg = "\nCould not fetch event to display span tree.";
      spanTreeLines = [isPlainOutput() ? msg : muted(msg)];
    }

    const trace = spanTreeResult?.success
      ? { traceId: spanTreeResult.traceId, spans: spanTreeResult.spans }
      : null;

    yield new CommandOutput({
      org: orgSlug ?? null,
      issue,
      event: event ?? null,
      replayIds,
      trace,
      spanTreeLines,
    });
    return {
      hint: `Tip: Use 'sentry issue explain ${issueArg}' for AI root cause analysis`,
    };
  },
});
