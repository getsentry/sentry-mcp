import { setTag } from "@sentry/core";
import { z } from "zod";
import type {
  ReplayDetails,
  ReplayRecordingEvent,
  SentryApiService,
} from "../../api-client";
import { UserInputError } from "../../errors";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { defineTool } from "../../internal/tool-helpers/define";
import { resolveRegionUrlForOrganization } from "../../internal/tool-helpers/resolve-region-url";
import { parseSentryUrl } from "../../internal/url-helpers";
import { resolveScopedOrganizationSlug } from "../../internal/url-scope";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamReplayId,
  ParamReplayUrl,
} from "../../schema";
import type { ServerContext } from "../../types";

const ReplayTimelineEventType = z.enum([
  "navigation",
  "click",
  "error",
  "console",
  "network",
  "performance",
  "other",
]);
type ReplayTimelineEventType = z.infer<typeof ReplayTimelineEventType>;

interface TimelineEvent {
  timestampMs: number;
  type: ReplayTimelineEventType;
  label: string;
  details: string[];
}

interface ResolvedReplayParams {
  organizationSlug: string;
  replayId: string;
}

export default defineTool({
  name: "inspect_replay_timeline",
  skills: ["inspect"],
  requiredScopes: ["org:read", "project:read", "event:read"],
  requiredCapabilities: ["replays"],
  description: [
    "Inspect the timestamped activity timeline for a specific Sentry replay.",
    "",
    "Use this tool when you need to:",
    "- Reconstruct what a user did before an error or frustrating interaction",
    "- Inspect navigation, clicks, console messages, network activity, and performance spans",
    "- Focus on a time window around a known moment in a replay",
    "",
    "<examples>",
    "inspect_replay_timeline(replayUrl='https://my-org.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/')",
    "inspect_replay_timeline(organizationSlug='my-org', replayId='7e07485f-12f9-416b-8b14-26260799b51f', eventTypes=['click', 'error', 'network'])",
    "inspect_replay_timeline(replayUrl='https://my-org.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/', aroundTimestamp='2026-07-23T19:14:21Z', windowSeconds=30)",
    "</examples>",
    "",
    "<hints>",
    "- aroundTimestamp is an absolute ISO-8601 timestamp; windowSeconds applies before and after it",
    "- Use get_replay_details for replay metadata and related issues or traces",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    replayUrl: ParamReplayUrl.optional(),
    organizationSlug: ParamOrganizationSlug.optional(),
    replayId: ParamReplayId.optional(),
    regionUrl: ParamRegionUrl.nullable().optional(),
    aroundTimestamp: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("Optional absolute ISO-8601 timestamp to inspect around."),
    windowSeconds: z
      .number()
      .int()
      .min(1)
      .max(300)
      .optional()
      .describe(
        "Seconds before and after aroundTimestamp to include. Defaults to 30.",
      ),
    eventTypes: z
      .array(ReplayTimelineEventType)
      .min(1)
      .optional()
      .describe("Optional event categories to include."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum timeline events to return. Defaults to 50."),
  },
  annotations: {
    readOnlyHint: true,
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

    if (replay.is_archived) {
      return formatUnavailableTimeline(
        replay,
        resolved.organizationSlug,
        params.replayUrl ??
          apiService.getReplayUrl(resolved.organizationSlug, replay.id),
        "The recording is archived, so its activity timeline is no longer available.",
      );
    }

    if (replay.project_id == null || (replay.count_segments ?? 0) === 0) {
      return formatUnavailableTimeline(
        replay,
        resolved.organizationSlug,
        params.replayUrl ??
          apiService.getReplayUrl(resolved.organizationSlug, replay.id),
        "No recording segments are available for this replay.",
      );
    }

    const segments = await apiService.getReplayRecordingSegments({
      organizationSlug: resolved.organizationSlug,
      projectSlugOrId: String(replay.project_id),
      replayId: resolved.replayId,
    });
    const allEvents = segments
      .flat()
      .flatMap((event) => normalizeReplayEvent(event))
      .sort((a, b) => a.timestampMs - b.timestampMs);
    const replayStartMs =
      parseTimestamp(replay.started_at) ?? allEvents[0]?.timestampMs;
    const aroundMs = params.aroundTimestamp
      ? Date.parse(params.aroundTimestamp)
      : null;
    const selectedTypes = params.eventTypes
      ? new Set<ReplayTimelineEventType>(params.eventTypes)
      : null;
    const windowSeconds = params.windowSeconds ?? 30;
    const limit = params.limit ?? 50;
    const windowMs = windowSeconds * 1000;
    const filteredEvents = allEvents.filter((event) => {
      if (selectedTypes && !selectedTypes.has(event.type)) {
        return false;
      }
      return (
        aroundMs === null || Math.abs(event.timestampMs - aroundMs) <= windowMs
      );
    });
    const displayedEvents = filteredEvents.slice(0, limit);

    return formatTimeline({
      replay,
      organizationSlug: resolved.organizationSlug,
      replayUrl:
        params.replayUrl ??
        apiService.getReplayUrl(resolved.organizationSlug, replay.id),
      events: displayedEvents,
      replayStartMs,
      aroundTimestamp: params.aroundTimestamp,
      windowSeconds,
      eventTypes: params.eventTypes,
      omittedCount: filteredEvents.length - displayedEvents.length,
    });
  },
});

function resolveReplayParams(params: {
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
      organizationSlug: resolveScopedOrganizationSlug({
        resourceLabel: "Replay",
        scopedOrganizationSlug: params.organizationSlug,
        urlOrganizationSlug: parsed.organizationSlug,
      }),
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

async function assertReplayWithinProjectConstraint({
  apiService,
  organizationSlug,
  replay,
  projectSlug,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  replay: ReplayDetails;
  projectSlug?: string | null;
}): Promise<void> {
  if (!projectSlug) return;
  if (replay.project_id == null) {
    throw new UserInputError(
      `Replay is outside the active project constraint. Expected project "${projectSlug}".`,
    );
  }
  const project = await apiService.getProject({
    organizationSlug,
    projectSlugOrId: projectSlug,
  });
  if (String(project.id) !== String(replay.project_id)) {
    throw new UserInputError(
      `Replay is outside the active project constraint. Expected project "${projectSlug}".`,
    );
  }
}

function normalizeReplayEvent(event: ReplayRecordingEvent): TimelineEvent[] {
  const timestampMs = getEventTimestampMillis(event.timestamp);
  if (timestampMs === null || !event.data) return [];

  if (event.data.href) {
    return [
      {
        timestampMs,
        type: "navigation",
        label: "Page view",
        details: [`url=${quote(event.data.href)}`],
      },
    ];
  }

  const tag = event.data.tag;
  const payload = event.data.payload;
  if (!tag || !payload) return [];
  const category = firstString(payload.category);
  const op = firstString(payload.op);
  const message = firstString(payload.message, payload.description);
  const normalized = `${tag} ${category ?? ""} ${op ?? ""}`.toLowerCase();
  const type = classifyEvent(normalized);
  const details = formatPayloadDetails(payload);

  if (type === "other" && details.length === 0) return [];
  return [
    {
      timestampMs,
      type,
      label: formatEventLabel(type, tag, category, op),
      details,
    },
  ];
}

function classifyEvent(value: string): ReplayTimelineEventType {
  if (/(ui\.click|rage|dead\.click)/.test(value)) return "click";
  if (/(exception|error)/.test(value)) return "error";
  if (/console/.test(value)) return "console";
  if (/(fetch|xhr|resource\.|http|network)/.test(value)) return "network";
  if (/(navigation|page\.view|route)/.test(value)) return "navigation";
  if (/(performance|pageload|web\.vital|span)/.test(value))
    return "performance";
  return "other";
}

function formatEventLabel(
  type: ReplayTimelineEventType,
  tag: string,
  category: string | null,
  op: string | null,
): string {
  if (op) return op;
  if (category && category !== type) return category;
  if (tag !== "breadcrumb") return tag;
  return type;
}

function formatPayloadDetails(payload: Record<string, unknown>): string[] {
  const data = isRecord(payload.data) ? payload.data : null;
  const values: Array<[string, unknown]> = [
    ["message", payload.message ?? payload.description],
    ["url", data?.url ?? data?.to],
    ["method", data?.method],
    ["status", data?.status_code ?? data?.statusCode],
    ["duration_ms", data?.duration],
    ["level", data?.level],
  ];
  return values.flatMap(([key, value]) => {
    if (typeof value === "string" && value.trim()) {
      return [`${key}=${quote(value)}`];
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return [`${key}=${value}`];
    }
    return [];
  });
}

function formatTimeline({
  replay,
  organizationSlug,
  replayUrl,
  events,
  replayStartMs,
  aroundTimestamp,
  windowSeconds,
  eventTypes,
  omittedCount,
}: {
  replay: ReplayDetails;
  organizationSlug: string;
  replayUrl: string;
  events: TimelineEvent[];
  replayStartMs?: number;
  aroundTimestamp?: string;
  windowSeconds: number;
  eventTypes?: ReplayTimelineEventType[];
  omittedCount: number;
}): string {
  const lines = [
    `# Replay Timeline ${replay.id} in **${organizationSlug}**`,
    "",
    `- **Replay URL**: ${replayUrl}`,
    `- **Started**: ${replay.started_at ?? "Unknown"}`,
  ];
  if (aroundTimestamp) {
    lines.push(
      `- **Time Window**: ${windowSeconds}s before and after ${aroundTimestamp}`,
    );
  }
  if (eventTypes) lines.push(`- **Event Types**: ${eventTypes.join(", ")}`);
  lines.push("", "## Timeline", "");

  if (events.length === 0) {
    lines.push(
      "No matching activity events were recorded in this time window.",
    );
  } else {
    for (const event of events) {
      const offset =
        replayStartMs == null
          ? new Date(event.timestampMs).toISOString()
          : formatRelativeTime(event.timestampMs - replayStartMs);
      const details =
        event.details.length > 0 ? ` · ${event.details.join(" · ")}` : "";
      lines.push(
        `- ${offset} · **${event.type}** · \`${event.label}\`${details}`,
      );
    }
  }
  if (omittedCount > 0) {
    lines.push(
      "",
      `${omittedCount} additional matching event${omittedCount === 1 ? " was" : "s were"} omitted. Increase \`limit\` to return more.`,
    );
  }
  lines.push(
    "",
    "## Response Notes",
    "",
    "- Use `get_replay_details` with this replay URL to inspect related issues and traces.",
  );
  return lines.join("\n");
}

function formatUnavailableTimeline(
  replay: ReplayDetails,
  organizationSlug: string,
  replayUrl: string,
  reason: string,
): string {
  return [
    `# Replay Timeline ${replay.id} in **${organizationSlug}**`,
    "",
    `- **Replay URL**: ${replayUrl}`,
    "",
    "## Timeline",
    "",
    reason,
  ].join("\n");
}

function getEventTimestampMillis(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return value > 1e12 ? value : value * 1000;
}

function parseTimestamp(value?: string | null): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function formatRelativeTime(offsetMs: number): string {
  const seconds = Math.max(0, Math.round(offsetMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0
    ? `T+${minutes}m${remainder > 0 ? ` ${remainder}s` : ""}`
    : `T+${remainder}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function quote(value: string): string {
  return JSON.stringify(value.trim());
}
