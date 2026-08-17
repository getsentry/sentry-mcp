import { setTag } from "@sentry/core";
import type {
  ReplayDetails,
  ReplayErrorEvent,
  ReplayRecordingSegments,
  ReplayRecordingSegmentsResult,
  SentryApiService,
  TraceMeta,
} from "../../api-client";
import {
  MAX_REPLAY_SEGMENTS,
  MAX_REPLAY_SEGMENT_BYTES,
} from "../../api-client";
import type {
  ReplayKindCount,
  ReplaySignal,
  ReplaySignalKind,
} from "../../internal/replay-events";
import {
  countReplayKinds,
  extractReplaySignals,
  formatReplayOffset,
} from "../../internal/replay-events";
import {
  formatToolCall,
  formatToolCallInstruction,
} from "../../internal/tool-helpers/tool-call-formatting";
import {
  assertReplayWithinProjectConstraint,
  resolveReplayParams,
} from "../../internal/tool-helpers/replay";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { resolveRegionUrlForOrganization } from "../../internal/tool-helpers/resolve-region-url";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamReplayId,
  ParamRegionUrl,
  ParamReplayUrl,
} from "../../schema";

interface ResolvedReplayParams {
  organizationSlug: string;
  replayId: string;
}

interface RelatedReplayIssue {
  eventId: string;
  shortId: string | null;
  title: string | null;
}

interface RelatedReplayTrace {
  traceId: string;
  traceMeta: TraceMeta | null;
}

/** A time-bounded section of the session, from Sentry's AI summary. */
interface ReplayChapter {
  startMs: number;
  endMs: number;
  title: string;
}

const MAX_RELATED_ERRORS = 3;
const MAX_RELATED_TRACES = 2;

/** Pages shown in the flow line before it is summarized with a count. */
const MAX_FLOW_PAGES = 6;

/**
 * Half-width of the suggested zoom window around an error.
 *
 * Wide enough to include the interaction that caused the failure and the
 * fallout after it, narrow enough that the window is still a zoom.
 */
const ERROR_WINDOW_PADDING_MS = 5000;

export default defineTool({
  name: "get_replay_details",
  skills: ["inspect"],
  requiredScopes: ["org:read", "project:read", "event:read"],
  requiredCapabilities: ["replays"],
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
    "get_replay_details(replayUrl='https://my-organization.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/')",
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
    regionUrl: ParamRegionUrl.nullable().optional(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const resolved = resolveReplayParams(params);
    const regionUrl = await resolveRegionUrlForOrganization({
      context,
      organizationSlug: resolved.organizationSlug,
      regionUrl: params.regionUrl,
    });
    const apiService = apiServiceFromContext(context, {
      regionUrl: regionUrl ?? undefined,
    });

    setTag("organization.slug", resolved.organizationSlug);
    setTag("replay.id", resolved.replayId);

    const replay = await apiService.getReplayDetails({
      organizationSlug: resolved.organizationSlug,
      replayId: resolved.replayId,
    });
    await assertReplayWithinProjectConstraint({
      apiService,
      organizationSlug: resolved.organizationSlug,
      replay,
      projectSlug: context.constraints.projectSlug,
    });

    const isArchived = replay.is_archived === true;
    const projectId =
      replay.project_id != null ? String(replay.project_id) : null;
    const hasSegments = (replay.count_segments ?? 0) > 0;

    const [{ segments, truncatedBy }, errorEvents, relatedTraces, chapters] =
      await Promise.all([
        fetchReplaySegments({
          apiService,
          organizationSlug: resolved.organizationSlug,
          replayId: resolved.replayId,
          projectId,
          isArchived,
          hasSegments,
        }),
        fetchReplayErrorEvents({
          apiService,
          organizationSlug: resolved.organizationSlug,
          errorIds: replay.error_ids,
          projectId,
        }),
        fetchReplayTraces({
          apiService,
          organizationSlug: resolved.organizationSlug,
          traceIds: replay.trace_ids,
        }),
        fetchReplayChapters({
          apiService,
          organizationSlug: resolved.organizationSlug,
          projectId,
          replayId: resolved.replayId,
          startedAt: replay.started_at,
          isArchived,
        }),
      ]);

    const signals = extractReplaySignals(segments, {
      startedAt: replay.started_at,
      platform: replay.platform,
    });
    const kindCounts = countReplayKinds(segments);

    return formatReplayOutput({
      replay,
      organizationSlug: resolved.organizationSlug,
      replayUrl:
        params.replayUrl ??
        apiService.getReplayUrl(resolved.organizationSlug, replay.id),
      segments,
      signals,
      kindCounts,
      chapters,
      nextStepLines: buildNextStepLines({
        organizationSlug: resolved.organizationSlug,
        replayId: replay.id,
        errorEvents,
        startedAt: replay.started_at,
        context,
      }),
      truncatedBy,
      isArchived,
      relatedIssues: toRelatedIssues(replay.error_ids, errorEvents).slice(
        0,
        MAX_RELATED_ERRORS,
      ),
      omittedIssues: Math.max(0, replay.error_ids.length - MAX_RELATED_ERRORS),
      relatedTraces,
      omittedTraces: Math.max(0, replay.trace_ids.length - MAX_RELATED_TRACES),
    });
  },
});

function formatReplayOutput({
  replay,
  organizationSlug,
  replayUrl,
  segments,
  signals,
  kindCounts,
  chapters,
  nextStepLines,
  truncatedBy,
  isArchived,
  relatedIssues,
  omittedIssues,
  relatedTraces,
  omittedTraces,
}: {
  replay: ReplayDetails;
  organizationSlug: string;
  replayUrl: string;
  segments: ReplayRecordingSegments | null;
  signals: ReplaySignal[];
  kindCounts: ReplayKindCount[];
  chapters: ReplayChapter[];
  nextStepLines: string[];
  truncatedBy: ReplayRecordingSegmentsResult["truncatedBy"];
  isArchived: boolean;
  relatedIssues: RelatedReplayIssue[];
  omittedIssues: number;
  relatedTraces: RelatedReplayTrace[];
  omittedTraces: number;
}): string {
  const lines: string[] = [];
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
    null;

  // Summary
  lines.push(`# Replay ${replay.id} in **${organizationSlug}**`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Replay URL**: ${replayUrl}`);
  lines.push(
    `- **Duration**: ${replay.duration != null ? formatDurationSeconds(replay.duration) : "Unknown"}`,
  );
  lines.push(`- **Environment**: ${replay.environment ?? "Unknown"}`);
  lines.push(
    `- **Browser**: ${formatNameVersion(replay.browser?.name, replay.browser?.version)}`,
  );
  lines.push(
    `- **OS**: ${formatNameVersion(replay.os?.name, replay.os?.version)}`,
  );
  lines.push(`- **User**: ${user}`);
  if (replay.urls.length > 0) {
    lines.push(`- **URLs**: ${replay.urls.slice(0, 3).join(", ")}`);
  }
  if (device) {
    lines.push(`- **Device**: ${device}`);
  }
  if (replay.releases && replay.releases.length > 0) {
    lines.push(`- **Release**: ${replay.releases[0]}`);
  }
  if (replay.replay_type) {
    lines.push(`- **Replay Type**: ${replay.replay_type}`);
  }
  lines.push(`- **Errors**: ${replay.count_errors ?? 0}`);
  lines.push(`- **Rage Clicks**: ${replay.count_rage_clicks ?? 0}`);
  lines.push(`- **Dead Clicks**: ${replay.count_dead_clicks ?? 0}`);
  lines.push(`- **Warnings**: ${replay.count_warnings ?? 0}`);
  lines.push(`- **Infos**: ${replay.count_infos ?? 0}`);
  if (replay.count_segments != null) {
    lines.push(`- **Recording Segments**: ${replay.count_segments}`);
  }
  lines.push(`- **Archived**: ${isArchived ? "Yes" : "No"}`);
  if (replay.has_viewed != null) {
    lines.push(`- **Viewed**: ${replay.has_viewed ? "Yes" : "No"}`);
  }

  // Map — the shape of the session rather than a sample of it. A fixed-length
  // prose sample either truncates a long session or floods a short one, and
  // neither tells the reader where to look.
  lines.push("");
  lines.push("## Map");
  lines.push("");

  if (isArchived) {
    lines.push("Recording is archived and not available for playback.");
  } else if (segments === null) {
    lines.push("Recording is unavailable.");
  } else if (signals.length === 0) {
    lines.push("No activity recorded.");
  } else {
    lines.push(`- **Signals**: ${formatSignalSpan(signals)}`);

    const flow = buildPageFlow(signals, replay.urls);
    if (flow) {
      lines.push(`- **Flow**: ${flow}`);
    }

    lines.push(`- **Kinds**: ${formatKindBreakdown(kindCounts, signals)}`);
    lines.push(`- **Truncated**: ${formatTruncation(truncatedBy)}`);
  }

  // Chapters — present only when Sentry already has a summary for this replay.
  if (chapters.length > 0) {
    lines.push("");
    lines.push("## Chapters");
    lines.push("");
    for (const chapter of chapters) {
      lines.push(
        `- ${formatReplayOffset(chapter.startMs)}–${formatReplayOffset(chapter.endMs)}  ${chapter.title}`,
      );
    }
  }

  // Related
  const hasRelated = relatedIssues.length > 0 || relatedTraces.length > 0;
  if (hasRelated) {
    lines.push("");
    lines.push("## Related");
    lines.push("");

    for (const ri of relatedIssues) {
      if (ri.shortId) {
        lines.push(`- **${ri.shortId}**: ${ri.title ?? "Unknown error"}`);
      } else {
        lines.push(`- Event \`${ri.eventId}\``);
      }
    }
    // Stopping at a display limit without saying so reads as "this is all of
    // them".
    if (omittedIssues > 0) {
      lines.push(
        `- …and ${omittedIssues} more error${omittedIssues === 1 ? "" : "s"}`,
      );
    }

    for (const rt of relatedTraces) {
      const spanInfo = rt.traceMeta
        ? ` (${rt.traceMeta.span_count} spans)`
        : "";
      lines.push(`- Trace \`${rt.traceId}\`${spanInfo}`);
    }
    if (omittedTraces > 0) {
      lines.push(
        `- …and ${omittedTraces} more trace${omittedTraces === 1 ? "" : "s"}`,
      );
    }

    lines.push("");
    lines.push(
      "Use `get_sentry_resource` to inspect any issue or trace listed above.",
    );
  }

  // Next — a concrete call, windowed on this replay's own failure when one is
  // resolvable, so the reader does not have to guess where to zoom.
  if (!isArchived && segments !== null && signals.length > 0) {
    lines.push("");
    lines.push("## Next");
    lines.push("");
    lines.push(...nextStepLines);
  }

  return lines.join("\n");
}

/**
 * Describe how much happened and over what span.
 */
function formatSignalSpan(signals: ReplaySignal[]): string {
  const offsets = signals
    .map((signal) => signal.offsetMs)
    .filter((offset): offset is number => offset !== null);

  const count = `${signals.length.toLocaleString("en-US")} signal${signals.length === 1 ? "" : "s"}`;
  if (offsets.length === 0) {
    return count;
  }

  const first = formatReplayOffset(Math.min(...offsets));
  const last = formatReplayOffset(Math.max(...offsets));
  return `${count} across ${first}–${last}`;
}

/**
 * Render the page flow as an ordered path.
 *
 * Built from navigation signals when the recording has them, since those carry
 * ordering. `replay.urls` is a fallback: it lists the pages visited but is
 * metadata rather than a timeline.
 */
function buildPageFlow(signals: ReplaySignal[], urls: string[]): string | null {
  const visited: string[] = [];

  for (const signal of signals) {
    if (signal.kind !== "navigation") {
      continue;
    }
    const page = toPagePath(signal.summary.replace(/^Navigated to /, ""));
    if (page !== visited.at(-1)) {
      visited.push(page);
    }
  }

  const flow = visited.length > 0 ? visited : urls;
  if (flow.length === 0) {
    return null;
  }

  const shown = flow.slice(0, MAX_FLOW_PAGES);
  const suffix =
    flow.length > MAX_FLOW_PAGES ? ` …+${flow.length - MAX_FLOW_PAGES}` : "";
  return `${shown.join(" ▸ ")}${suffix}`;
}

/**
 * Reduce a navigation target to its path.
 *
 * The flow line is about where the user went, and repeating the host on every
 * hop crowds out that shape. `replay.urls` is already path-only, so this also
 * keeps both sources of the flow consistent.
 */
function toPagePath(page: string): string {
  const withoutHost = page.replace(/^[^/]+/, "");
  return withoutHost.startsWith("/") ? withoutHost : `/${page}`;
}

/**
 * Summarize each kind with its failure count.
 *
 * Counts come from every classified event, including ones that are never
 * rendered, so `network 58 (2 failed)` means 58 requests of which 2 are shown.
 * Click kinds are folded into one entry with their rage and dead counts, which
 * is how the Sentry UI presents them.
 */
function formatKindBreakdown(
  kindCounts: ReplayKindCount[],
  signals: ReplaySignal[],
): string {
  const byKind = new Map(kindCounts.map((entry) => [entry.kind, entry]));
  const parts: string[] = [];

  const navigation = byKind.get("navigation");
  if (navigation) {
    parts.push(`navigation ${navigation.total}`);
  }

  const clicks = ["click", "dead-click", "rage-click", "slow-click"] as const;
  const clickTotal = clicks.reduce(
    (total, kind) => total + (byKind.get(kind)?.total ?? 0),
    0,
  );
  if (clickTotal > 0) {
    const rage = byKind.get("rage-click")?.total ?? 0;
    const dead = byKind.get("dead-click")?.total ?? 0;
    const notes = [
      rage > 0 ? `${rage} rage` : null,
      dead > 0 ? `${dead} dead` : null,
    ].filter(Boolean);
    parts.push(
      `click ${clickTotal}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`,
    );
  }

  const network = byKind.get("network");
  if (network) {
    parts.push(
      `network ${network.total}${network.errors > 0 ? ` (${network.errors} failed)` : ""}`,
    );
  }

  const consoleCount = byKind.get("console");
  if (consoleCount) {
    parts.push(
      `console ${consoleCount.total}${consoleCount.errors > 0 ? ` (${consoleCount.errors} error)` : ""}`,
    );
  }

  // Anything not called out above, so no kind disappears from the breakdown.
  const named = new Set<ReplaySignalKind>([
    "navigation",
    ...clicks,
    "network",
    "console",
  ]);
  for (const entry of kindCounts) {
    if (!named.has(entry.kind)) {
      parts.push(`${entry.kind} ${entry.total}`);
    }
  }

  return parts.length > 0 ? parts.join(" · ") : `${signals.length} signals`;
}

function formatTruncation(
  truncatedBy: ReplayRecordingSegmentsResult["truncatedBy"],
): string {
  if (truncatedBy === "segments") {
    return `yes — read the first ${MAX_REPLAY_SEGMENTS} segments; later activity is not included`;
  }
  if (truncatedBy === "bytes") {
    return `yes — read the first ${MAX_REPLAY_SEGMENT_BYTES / (1024 * 1024)}MB of recording; later activity is not included`;
  }
  return "no";
}

function formatDurationSeconds(durationSeconds: number): string {
  if (durationSeconds < 60) {
    return `${durationSeconds}s`;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
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
  truncatedBy: ReplayRecordingSegmentsResult["truncatedBy"];
}> {
  if (isArchived || !projectId || !hasSegments) {
    return { segments: null, truncatedBy: null };
  }

  try {
    const result = await apiService.getReplayRecordingSegments({
      organizationSlug,
      projectSlugOrId: projectId,
      replayId,
    });
    return { segments: result.segments, truncatedBy: result.truncatedBy };
  } catch {
    return { segments: null, truncatedBy: null };
  }
}

/**
 * Resolve the replay's error events.
 *
 * One batched call replaces the per-error `listIssues` lookups this section
 * used to make — up to three sequential requests — and returns event
 * timestamps as well as issue identity, which `listIssues` cannot provide.
 *
 * The endpoint is PRIVATE, so failure degrades to an empty list: the map is
 * worth returning without a Related section, but not worth failing over one.
 */
async function fetchReplayErrorEvents({
  apiService,
  organizationSlug,
  errorIds,
  projectId,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  errorIds: string[];
  projectId: string | null;
}): Promise<ReplayErrorEvent[]> {
  if (errorIds.length === 0) {
    return [];
  }

  try {
    return await apiService.getReplayErrorEvents({
      organizationSlug,
      errorIds,
      projectId: projectId ?? undefined,
    });
  } catch {
    return [];
  }
}

/**
 * Read Sentry's AI summary and convert it into chapters.
 *
 * Strictly additive: any failure, any non-`completed` status, or an
 * unparseable body yields no chapters and leaves the map untouched. Chapters
 * therefore appear only for replays already summarized in the Sentry UI, which
 * is the accepted cost of never starting a Seer run from here.
 */
async function fetchReplayChapters({
  apiService,
  organizationSlug,
  projectId,
  replayId,
  startedAt,
  isArchived,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  projectId: string | null;
  replayId: string;
  startedAt?: string | null;
  isArchived: boolean;
}): Promise<ReplayChapter[]> {
  if (isArchived || !projectId) {
    return [];
  }

  const originMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (Number.isNaN(originMs)) {
    // Without a session origin the chapter windows cannot be placed on the
    // replay's timeline, and an absolute epoch is not useful to the reader.
    return [];
  }

  try {
    const summary = await apiService.getReplaySummary({
      organizationSlug,
      projectSlugOrId: projectId,
      replayId,
    });

    if (summary.status !== "completed") {
      return [];
    }

    return (summary.data?.time_ranges ?? []).map((range) => ({
      startMs: range.period_start - originMs,
      endMs: range.period_end - originMs,
      title: range.period_title,
    }));
  } catch {
    return [];
  }
}

/**
 * Pair each of the replay's error ids with whatever the lookup resolved.
 *
 * `error_ids` is the source of truth for which errors this replay has; the
 * meta lookup only enriches them with issue identity. An id that fails to
 * resolve is still listed by id — dropping it would understate the session,
 * and the endpoint is private enough to fail on its own.
 */
function toRelatedIssues(
  errorIds: string[],
  errorEvents: ReplayErrorEvent[],
): RelatedReplayIssue[] {
  const byId = new Map(errorEvents.map((event) => [event.id, event]));

  return errorIds.map((eventId) => {
    const event = byId.get(eventId);
    return {
      eventId,
      shortId: event?.issue ?? null,
      title: event?.title ?? null,
    };
  });
}

/**
 * Build the suggested follow-up call.
 *
 * Prefers a window bracketing the replay's first resolvable error, since that
 * is almost always what the reader is looking for. Falls back to a
 * whole-session digest when no error timestamp resolves — the endpoint is
 * private and may be unavailable — so there is always a concrete next call.
 */
function buildNextStepLines({
  organizationSlug,
  replayId,
  errorEvents,
  startedAt,
  context,
}: {
  organizationSlug: string;
  replayId: string;
  errorEvents: ReplayErrorEvent[];
  startedAt?: string | null;
  context: ServerContext;
}): string[] {
  const instruction = formatToolCallInstruction({
    toolName: "get_replay_activity",
    experimentalMode: context.experimentalMode ?? false,
    availableToolNames: context.availableToolNames,
    directToolNames: context.directToolNames,
    fallbackInstruction:
      "Replay activity lookup is not available in this session",
    purpose: "to read the signals in a time window",
  });

  const anchor = findErrorAnchor(errorEvents, startedAt);
  if (!anchor) {
    return [
      `${instruction}:`,
      formatToolCall({
        toolName: "get_replay_activity",
        arguments: { organizationSlug, replayId, grain: "digest" },
      }),
    ];
  }

  const startMs = Math.max(0, anchor.offsetMs - ERROR_WINDOW_PADDING_MS);
  const endMs = anchor.offsetMs + ERROR_WINDOW_PADDING_MS;

  return [
    `${anchor.label} occurred at ${formatReplayOffset(anchor.offsetMs)}. ${instruction}:`,
    formatToolCall({
      toolName: "get_replay_activity",
      arguments: {
        organizationSlug,
        replayId,
        startMs,
        endMs,
        grain: "detail",
      },
    }),
  ];
}

function findErrorAnchor(
  errorEvents: ReplayErrorEvent[],
  startedAt?: string | null,
): { offsetMs: number; label: string } | null {
  const originMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (Number.isNaN(originMs)) {
    return null;
  }

  for (const event of errorEvents) {
    if (!event.timestamp) {
      continue;
    }
    const timestampMs = Date.parse(event.timestamp);
    if (Number.isNaN(timestampMs)) {
      continue;
    }
    return {
      offsetMs: timestampMs - originMs,
      label: event.issue ? `Error ${event.issue}` : `Error \`${event.id}\``,
    };
  }

  return null;
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
