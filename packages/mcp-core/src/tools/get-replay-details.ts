import { setTag } from "@sentry/core";
import type {
  AutofixRunState,
  Issue,
  ReplayDetails,
  ReplayRecordingSegments,
  SentryApiService,
  TraceMeta,
} from "../api-client";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { getSeerActionabilityLabel } from "../internal/formatting";
import { parseSentryUrl } from "../internal/url-helpers";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamReplayId,
  ParamReplayUrl,
} from "../schema";

interface ResolvedReplayParams {
  organizationSlug: string;
  replayId: string;
}

interface ReplayActivityEvent {
  timestampMs: number | null;
  label: string;
  details: string[];
}

interface RelatedReplayIssue {
  eventId: string;
  issue: Issue | null;
  seerSummary: string | null;
}

interface RelatedReplayTrace {
  traceId: string;
  traceMeta: TraceMeta | null;
}

type AutofixStep = NonNullable<AutofixRunState["autofix"]>["steps"][number];

const MAX_ACTIVITY_EVENTS = 6;
const MAX_RELATED_ERRORS = 3;
const MAX_RELATED_TRACES = 2;

export default defineTool({
  name: "get_replay_details",
  skills: ["inspect"],
  requiredScopes: ["event:read"],
  requiredCapabilities: ["replays"],
  internalOnly: true, // Retained as a composition primitive behind get_sentry_resource. Do not expose directly via MCP.
  description: [
    "Get high-level information about a specific Sentry replay by URL or replay ID.",
    "",
    "USE THIS TOOL WHEN USERS:",
    "- Share a replay URL",
    "- Ask what happened in a specific replay",
    "- Want a concise replay summary plus the next issue or trace lookups to run",
    "",
    "<examples>",
    "### With replay URL",
    "```",
    "get_replay_details(replayUrl='https://my-organization.sentry.io/replays/7e07485f-12f9-416b-8b14-26260799b51f/')",
    "```",
    "",
    "### With organization and replay ID",
    "```",
    "get_replay_details(organizationSlug='my-organization', replayId='7e07485f-12f9-416b-8b14-26260799b51f')",
    "```",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    replayUrl: ParamReplayUrl.optional(),
    organizationSlug: ParamOrganizationSlug.optional(),
    replayId: ParamReplayId.optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const resolved = resolveReplayParams(params);
    const apiService = apiServiceFromContext(context);

    setTag("organization.slug", resolved.organizationSlug);
    setTag("replay.id", resolved.replayId);

    const replay = await apiService.getReplayDetails({
      organizationSlug: resolved.organizationSlug,
      replayId: resolved.replayId,
    });

    const isArchived = replay.is_archived === true;
    const projectId =
      replay.project_id !== null && replay.project_id !== undefined
        ? String(replay.project_id)
        : null;
    const hasSegments = (replay.count_segments ?? 0) > 0;

    const [{ segments, segmentsError }, relatedIssues, relatedTraces] =
      await Promise.all([
        fetchReplaySegments({
          apiService,
          organizationSlug: resolved.organizationSlug,
          replayId: resolved.replayId,
          projectId,
          isArchived,
          hasSegments,
        }),
        fetchReplayIssues({
          apiService,
          organizationSlug: resolved.organizationSlug,
          errorIds: replay.error_ids,
        }),
        fetchReplayTraces({
          apiService,
          organizationSlug: resolved.organizationSlug,
          traceIds: replay.trace_ids,
        }),
      ]);

    return formatReplayOutput({
      replay,
      organizationSlug: resolved.organizationSlug,
      replayUrl:
        params.replayUrl ??
        apiService.getReplayUrl(resolved.organizationSlug, replay.id),
      segments,
      segmentsError,
      relatedIssues,
      relatedTraces,
    });
  },
});

export function resolveReplayParams(params: {
  replayUrl?: string | null;
  organizationSlug?: string | null;
  replayId?: string | null;
}): ResolvedReplayParams {
  if (params.replayUrl) {
    const parsed = parseSentryUrl(params.replayUrl);
    if (parsed.type !== "replay" || !parsed.replayId) {
      throw new UserInputError(
        "Invalid replay URL. URL must point to a Sentry replay resource.",
      );
    }
    return {
      organizationSlug: parsed.organizationSlug,
      replayId: parsed.replayId,
    };
  }

  if (!params.organizationSlug || !params.replayId) {
    throw new UserInputError(
      "Provide either `replayUrl` or both `organizationSlug` and `replayId`.",
    );
  }

  return {
    organizationSlug: params.organizationSlug,
    replayId: params.replayId,
  };
}

function formatReplayOutput({
  replay,
  organizationSlug,
  replayUrl,
  segments,
  segmentsError,
  relatedIssues,
  relatedTraces,
}: {
  replay: ReplayDetails;
  organizationSlug: string;
  replayUrl: string;
  segments: ReplayRecordingSegments | null;
  segmentsError: string | null;
  relatedIssues: RelatedReplayIssue[];
  relatedTraces: RelatedReplayTrace[];
}): string {
  const lines: string[] = [];
  const isArchived = replay.is_archived === true;
  const user =
    replay.user?.display_name ??
    replay.user?.email ??
    replay.user?.username ??
    replay.user?.id ??
    "Anonymous User";
  const device =
    replay.device?.name ??
    replay.device?.model ??
    replay.device?.family ??
    "Unknown";
  const activityEvents = extractReplayActivityEvents(segments);
  const metadataEvents = buildReplayMetadataEvents({
    replay,
    relatedIssues,
    isArchived,
    segmentsError,
  });

  lines.push(`# Replay ${replay.id} in **${organizationSlug}**`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Replay URL**: ${replayUrl}`);
  lines.push(`- **Started**: ${replay.started_at ?? "Unknown"}`);
  lines.push(`- **Finished**: ${replay.finished_at ?? "Unknown"}`);
  lines.push(
    `- **Duration**: ${
      replay.duration !== null && replay.duration !== undefined
        ? formatDurationSeconds(replay.duration)
        : "Unknown"
    }`,
  );
  lines.push(`- **Archived**: ${isArchived ? "Yes" : "No"}`);
  lines.push(`- **Environment**: ${replay.environment ?? "Unknown"}`);
  lines.push(`- **Platform**: ${replay.platform ?? "Unknown"}`);
  lines.push(
    `- **Browser**: ${formatNameVersion(replay.browser?.name, replay.browser?.version)}`,
  );
  lines.push(`- **User**: ${user}`);
  if (replay.urls.length > 0) {
    lines.push(`- **URLs**: ${replay.urls.slice(0, 3).join(", ")}`);
  }
  if (device !== "Unknown") {
    lines.push(`- **Device**: ${device}`);
  }
  lines.push(
    `- **Signal Counts**: errors=${replay.count_errors ?? 0}, warnings=${replay.count_warnings ?? 0}, infos=${replay.count_infos ?? 0}, dead_clicks=${replay.count_dead_clicks ?? 0}, rage_clicks=${replay.count_rage_clicks ?? 0}, segments=${replay.count_segments ?? 0}`,
  );

  lines.push("");
  lines.push("## Events");
  lines.push("");

  if (activityEvents.length > 0) {
    const startTime = activityEvents[0]?.timestampMs ?? null;
    for (const event of activityEvents) {
      const prefix =
        event.timestampMs !== null && startTime !== null
          ? `${formatRelativeTime(event.timestampMs - startTime)} · `
          : "";
      const details =
        event.details.length > 0 ? ` · ${event.details.join(" · ")}` : "";
      lines.push(`- ${prefix}\`${event.label}\`${details}`);
    }
  }

  if (metadataEvents.length > 0) {
    for (const metadataEvent of metadataEvents) {
      lines.push(metadataEvent);
    }
  } else if ((replay.count_segments ?? 0) === 0) {
    lines.push("- `recording_segments` · count=0");
  }

  if (replay.error_ids.length > 0 || replay.trace_ids.length > 0) {
    lines.push("");
    lines.push("## Related");
    lines.push("");
  }

  if (replay.error_ids.length > 0) {
    for (const relatedIssue of relatedIssues) {
      lines.push(`### Error Event \`${relatedIssue.eventId}\``);
      if (relatedIssue.issue) {
        lines.push(`**Issue ID**: ${relatedIssue.issue.shortId}`);
        lines.push(`**Summary**: ${relatedIssue.issue.title}`);
        lines.push(`**Status**: ${relatedIssue.issue.status}`);
        if (relatedIssue.issue.seerFixabilityScore != null) {
          lines.push(
            `**Seer Actionability**: ${getSeerActionabilityLabel(relatedIssue.issue.seerFixabilityScore)}`,
          );
        }
        if (relatedIssue.seerSummary) {
          lines.push(`**Cached Seer Summary**: ${relatedIssue.seerSummary}`);
        }
        lines.push(
          `**Next Step**: \`get_issue_details(organizationSlug='${organizationSlug}', eventId='${relatedIssue.eventId}')\``,
        );
        lines.push(
          `**Root Cause Analysis**: \`analyze_issue_with_seer(organizationSlug='${organizationSlug}', issueId='${relatedIssue.issue.shortId}')\``,
        );
      } else {
        lines.push(
          "**Summary**: Replay metadata references this error, but issue details were not resolved from the replay payload alone.",
        );
        lines.push(
          `**Next Step**: \`get_issue_details(organizationSlug='${organizationSlug}', eventId='${relatedIssue.eventId}')\``,
        );
      }
      lines.push("");
    }
  }

  if (replay.trace_ids.length > 0) {
    for (const relatedTrace of relatedTraces) {
      lines.push(`### Trace \`${relatedTrace.traceId}\``);
      if (relatedTrace.traceMeta) {
        lines.push(
          `**High-level Stats**: ${formatTraceMetaSummary(relatedTrace.traceMeta)}`,
        );
      } else {
        lines.push(
          "**High-level Stats**: Trace metadata was not available from this replay lookup.",
        );
      }
      lines.push(
        `**Next Step**: \`get_trace_details(organizationSlug='${organizationSlug}', traceId='${relatedTrace.traceId}')\``,
      );
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatDurationSeconds(durationSeconds: number): string {
  if (durationSeconds < 60) {
    return `${durationSeconds}s`;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function buildReplayMetadataEvents({
  replay,
  relatedIssues,
  isArchived,
  segmentsError,
}: {
  replay: ReplayDetails;
  relatedIssues: RelatedReplayIssue[];
  isArchived: boolean;
  segmentsError: string | null;
}): string[] {
  const lines: string[] = [];

  if (isArchived) {
    lines.push("- `recording_segments` · status=archived");
  } else if (segmentsError) {
    lines.push(
      `- \`recording_segments\` · status=unavailable · detail=${quoteDetail(segmentsError)}`,
    );
  } else if ((replay.count_segments ?? 0) === 0) {
    lines.push("- `recording_segments` · count=0");
  }

  if (relatedIssues.length > 0) {
    for (const relatedIssue of relatedIssues) {
      const details = [`event_id=${relatedIssue.eventId}`];
      if (relatedIssue.issue) {
        details.push(`issue_id=${relatedIssue.issue.shortId}`);
        details.push(`title=${quoteDetail(relatedIssue.issue.title)}`);
      }
      lines.push(`- metadata · \`error\` · ${details.join(" · ")}`);
    }
  } else if ((replay.count_errors ?? 0) > 0) {
    lines.push(`- metadata · \`error\` · count=${replay.count_errors}`);
  }

  if ((replay.count_dead_clicks ?? 0) > 0) {
    lines.push(
      `- metadata · \`dead_click\` · count=${replay.count_dead_clicks}`,
    );
  }

  if ((replay.count_rage_clicks ?? 0) > 0) {
    lines.push(
      `- metadata · \`rage_click\` · count=${replay.count_rage_clicks}`,
    );
  }

  if ((replay.count_warnings ?? 0) > 0) {
    lines.push(`- metadata · \`warning\` · count=${replay.count_warnings}`);
  }

  if ((replay.count_infos ?? 0) > 0) {
    lines.push(`- metadata · \`info\` · count=${replay.count_infos}`);
  }

  return lines;
}

async function fetchReplaySegments({
  apiService,
  organizationSlug,
  replayId,
  projectId,
  isArchived,
  hasSegments,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  replayId: string;
  projectId: string | null;
  isArchived: boolean;
  hasSegments: boolean;
}): Promise<{
  segments: ReplayRecordingSegments | null;
  segmentsError: string | null;
}> {
  if (isArchived || !projectId || !hasSegments) {
    return { segments: null, segmentsError: null };
  }

  try {
    const segments = await apiService.getReplayRecordingSegments({
      organizationSlug,
      projectSlugOrId: projectId,
      replayId,
    });
    return { segments, segmentsError: null };
  } catch (error) {
    return {
      segments: null,
      segmentsError:
        error instanceof Error
          ? error.message
          : "Unknown segment download error",
    };
  }
}

async function fetchReplayIssues({
  apiService,
  organizationSlug,
  errorIds,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  errorIds: string[];
}): Promise<RelatedReplayIssue[]> {
  const ids = errorIds.slice(0, MAX_RELATED_ERRORS);

  return Promise.all(
    ids.map(async (eventId) => {
      try {
        const [issue] = await apiService.listIssues({
          organizationSlug,
          query: eventId,
          limit: 1,
        });

        const resolvedIssue =
          issue ??
          (await maybeGetIssueById(apiService, organizationSlug, eventId));
        const autofixState = resolvedIssue
          ? await apiService
              .getAutofixState({
                organizationSlug,
                issueId: resolvedIssue.shortId,
              })
              .catch(() => undefined)
          : undefined;

        return {
          eventId,
          issue: resolvedIssue ?? null,
          seerSummary: getCachedSeerSummary(autofixState),
        };
      } catch {
        return {
          eventId,
          issue: null,
          seerSummary: null,
        };
      }
    }),
  );
}

async function maybeGetIssueById(
  apiService: SentryApiService,
  organizationSlug: string,
  errorId: string,
): Promise<Issue | null> {
  if (!looksLikeDirectIssueId(errorId)) {
    return null;
  }

  try {
    return await apiService.getIssue({
      organizationSlug,
      issueId: errorId,
    });
  } catch {
    return null;
  }
}

async function fetchReplayTraces({
  apiService,
  organizationSlug,
  traceIds,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  traceIds: string[];
}): Promise<RelatedReplayTrace[]> {
  const ids = traceIds.slice(0, MAX_RELATED_TRACES);

  return Promise.all(
    ids.map(async (traceId) => {
      try {
        const traceMeta = await apiService.getTraceMeta({
          organizationSlug,
          traceId,
        });
        return { traceId, traceMeta };
      } catch {
        return { traceId, traceMeta: null };
      }
    }),
  );
}

function formatNameVersion(
  name?: string | null,
  version?: string | null,
): string {
  if (name && version) {
    return `${name} ${version}`;
  }
  return name ?? version ?? "Unknown";
}

function extractReplayActivityEvents(
  segments: ReplayRecordingSegments | null,
): ReplayActivityEvent[] {
  if (!segments) {
    return [];
  }

  const events: ReplayActivityEvent[] = [];

  for (const segment of segments) {
    for (const event of segment) {
      const replayEvent = summarizeReplayEvent(event);
      if (replayEvent) {
        events.push(replayEvent);
      }
      if (events.length >= MAX_ACTIVITY_EVENTS) {
        return events;
      }
    }
  }

  return events;
}

function summarizeReplayEvent(event: unknown): ReplayActivityEvent | null {
  if (!isRecord(event)) {
    return null;
  }

  const timestampMs = getEventTimestampMillis(event.timestamp);
  const data = isRecord(event.data) ? event.data : null;
  const tag = typeof data?.tag === "string" ? data.tag : "";
  const payload = isRecord(data?.payload) ? data.payload : null;

  if (tag) {
    const replayEvent = summarizeTaggedReplayEvent(tag, payload);
    if (replayEvent) {
      return { timestampMs, ...replayEvent };
    }
  }

  if (typeof event.type === "number" && data) {
    const href = typeof data.href === "string" ? data.href : null;
    if (href) {
      return {
        timestampMs,
        label: "page.view",
        details: [`href=${href}`],
      };
    }
  }

  return null;
}

function summarizeTaggedReplayEvent(
  tag: string,
  payload: Record<string, unknown> | null,
): Omit<ReplayActivityEvent, "timestampMs"> | null {
  if (tag === "performanceSpan") {
    const op = firstString(payload?.op);
    const description = firstString(payload?.description);
    const durationMs =
      isRecord(payload?.data) && typeof payload.data.duration === "number"
        ? payload.data.duration
        : null;

    if (description || op) {
      return {
        label: op ?? "performanceSpan",
        details: [
          description ? `description=${description}` : null,
          durationMs !== null ? `duration_ms=${durationMs}` : null,
        ].filter((value): value is string => value !== null),
      };
    }
  }

  if (tag === "ui.click") {
    const message = firstString(payload?.message, payload?.description);
    if (message) {
      return {
        label: tag,
        details: [`message=${quoteDetail(message)}`],
      };
    }
  }

  const details = [
    firstString(payload?.message)
      ? `message=${quoteDetail(firstString(payload?.message)!)}` // eslint-disable-line @typescript-eslint/no-non-null-assertion
      : null,
    firstString(payload?.description)
      ? `description=${quoteDetail(firstString(payload?.description)!)}` // eslint-disable-line @typescript-eslint/no-non-null-assertion
      : null,
    firstString(payload?.category)
      ? `category=${quoteDetail(firstString(payload?.category)!)}` // eslint-disable-line @typescript-eslint/no-non-null-assertion
      : null,
    firstString(payload?.type)
      ? `type=${quoteDetail(firstString(payload?.type)!)}` // eslint-disable-line @typescript-eslint/no-non-null-assertion
      : null,
    summarizeObject(
      payload,
      new Set(["message", "description", "category", "type"]),
    ),
  ].filter((value): value is string => value !== null);

  return details.length > 0 ? { label: tag, details } : null;
}

function getEventTimestampMillis(value: unknown): number | null {
  if (typeof value !== "number") {
    return null;
  }
  return value > 1e12 ? value : value * 1000;
}

function formatRelativeTime(offsetMs: number): string {
  const offsetSeconds = Math.max(0, Math.round(offsetMs / 1000));
  if (offsetSeconds < 60) {
    return `T+${offsetSeconds}s`;
  }

  const minutes = Math.floor(offsetSeconds / 60);
  const seconds = offsetSeconds % 60;
  return seconds > 0 ? `T+${minutes}m ${seconds}s` : `T+${minutes}m`;
}

function formatTraceMetaSummary(traceMeta: TraceMeta): string {
  return [
    `${traceMeta.span_count} spans`,
    `${traceMeta.errors} errors`,
    `${traceMeta.performance_issues} performance issues`,
    `${traceMeta.logs} logs`,
  ].join(", ");
}

function getCachedSeerSummary(
  autofixState: AutofixRunState | undefined,
): string | null {
  const autofix = autofixState?.autofix;
  if (!autofix) {
    return null;
  }

  const completedSteps = autofix.steps.filter(
    (step) => step.status === "COMPLETED",
  );
  const rootCauseStep = completedSteps.find(
    (step) => step.type === "root_cause_analysis",
  );
  if (rootCauseStep && hasRootCauseCauses(rootCauseStep)) {
    const description = rootCauseStep.causes.find((cause) =>
      cause.description.trim(),
    )?.description;
    if (description) {
      return truncateSummary(description);
    }
  }

  const solutionStep = completedSteps.find((step) => step.type === "solution");
  if (solutionStep && hasSolutionDescription(solutionStep)) {
    return truncateSummary(solutionStep.description);
  }

  const insightStep = completedSteps.find(hasInsights);
  if (insightStep) {
    const insight = insightStep.insights.find((entry) =>
      entry.insight.trim(),
    )?.insight;
    if (insight) {
      return truncateSummary(insight);
    }
  }

  return null;
}

function hasRootCauseCauses(step: AutofixStep): step is AutofixStep & {
  type: "root_cause_analysis";
  causes: Array<{ description: string }>;
} {
  return (
    step.type === "root_cause_analysis" &&
    Array.isArray((step as { causes?: unknown }).causes)
  );
}

function hasSolutionDescription(step: AutofixStep): step is AutofixStep & {
  type: "solution";
  description: string;
} {
  return (
    step.type === "solution" &&
    typeof (step as { description?: unknown }).description === "string"
  );
}

function hasInsights(step: AutofixStep): step is AutofixStep & {
  type: "default";
  insights: Array<{ insight: string }>;
} {
  return (
    step.type === "default" &&
    Array.isArray((step as { insights?: unknown }).insights)
  );
}

function truncateSummary(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function summarizeObject(
  value: unknown,
  excludedKeys: ReadonlySet<string> = new Set(),
): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const entries = Object.entries(value)
    .filter(
      ([key, nested]) =>
        !excludedKeys.has(key) &&
        (typeof nested === "string" || typeof nested === "number"),
    )
    .slice(0, 3)
    .map(([key, nested]) => `${key}=${nested}`);

  return entries.length > 0
    ? `payload=${quoteDetail(entries.join(", "))}`
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function looksLikeDirectIssueId(value: string): boolean {
  return (
    /^\d+$/.test(value) ||
    (value.includes("-") && value === value.toUpperCase())
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quoteDetail(value: string): string {
  return JSON.stringify(value.trim());
}
