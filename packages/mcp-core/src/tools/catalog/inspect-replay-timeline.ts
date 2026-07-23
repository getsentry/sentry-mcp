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
import { structuredResult } from "../../internal/tool-helpers/results";
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

const timelineEventDetailSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const timelineEventSchema = z.object({
  timestampMs: z.number(),
  offsetMs: z.number().nullable(),
  type: ReplayTimelineEventType,
  label: z.string(),
  details: z.array(timelineEventDetailSchema),
});

export const inspectReplayTimelineOutputSchema = z.object({
  organizationSlug: z.string(),
  replayId: z.string(),
  replayUrl: z.string().url(),
  startedAt: z.string().nullable(),
  status: z.enum(["available", "archived", "unavailable"]),
  unavailableReason: z.string().nullable(),
  filters: z.object({
    aroundTimestamp: z.string().nullable(),
    windowSeconds: z.number(),
    eventTypes: z.array(ReplayTimelineEventType),
    limit: z.number(),
  }),
  totalMatchingEvents: z.number(),
  omittedCount: z.number(),
  events: z.array(timelineEventSchema),
});

type TimelineEvent = Omit<z.infer<typeof timelineEventSchema>, "offsetMs">;
type ReplayTimelineOutput = z.infer<typeof inspectReplayTimelineOutputSchema>;

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
  outputSchema: inspectReplayTimelineOutputSchema,
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

    const replayUrl =
      params.replayUrl ??
      apiService.getReplayUrl(resolved.organizationSlug, replay.id);
    const windowSeconds = params.windowSeconds ?? 30;
    const limit = params.limit ?? 50;
    const filters = {
      aroundTimestamp: params.aroundTimestamp ?? null,
      windowSeconds,
      eventTypes: params.eventTypes ?? [],
      limit,
    };

    if (replay.is_archived) {
      return structuredResult(
        unavailableTimeline({
          replay,
          organizationSlug: resolved.organizationSlug,
          replayUrl,
          status: "archived",
          reason:
            "The recording is archived, so its activity timeline is no longer available.",
          filters,
        }),
      );
    }

    if (replay.project_id == null || (replay.count_segments ?? 0) === 0) {
      return structuredResult(
        unavailableTimeline({
          replay,
          organizationSlug: resolved.organizationSlug,
          replayUrl,
          status: "unavailable",
          reason: "No recording segments are available for this replay.",
          filters,
        }),
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

    return structuredResult({
      organizationSlug: resolved.organizationSlug,
      replayId: replay.id,
      replayUrl,
      startedAt: replay.started_at ?? null,
      status: "available" as const,
      unavailableReason: null,
      filters,
      totalMatchingEvents: filteredEvents.length,
      omittedCount: filteredEvents.length - displayedEvents.length,
      events: displayedEvents.map((event) => ({
        ...event,
        offsetMs:
          replayStartMs == null
            ? null
            : Math.max(0, event.timestampMs - replayStartMs),
      })),
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
        details: [{ key: "url", value: event.data.href }],
      },
    ];
  }

  const tag = event.data.tag;
  const payload = event.data.payload;
  if (!tag || !payload) return [];
  const category = firstString(payload.category);
  const op = firstString(payload.op);
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

function formatPayloadDetails(
  payload: Record<string, unknown>,
): Array<z.infer<typeof timelineEventDetailSchema>> {
  const data = isRecord(payload.data) ? payload.data : null;
  const values: Array<[string, unknown]> = [
    ["message", payload.message ?? payload.description],
    ["url", data?.url ?? data?.to],
    ["method", data?.method],
    ["status", data?.status_code ?? data?.statusCode],
    ["durationMs", data?.duration],
    ["level", data?.level],
  ];
  const details: Array<z.infer<typeof timelineEventDetailSchema>> = [];
  for (const [key, value] of values) {
    if (typeof value === "string" && value.trim()) {
      details.push({ key, value: value.trim() });
    } else if (typeof value === "number" || typeof value === "boolean") {
      details.push({ key, value });
    }
  }
  return details;
}

function unavailableTimeline({
  replay,
  organizationSlug,
  replayUrl,
  status,
  reason,
  filters,
}: {
  replay: ReplayDetails;
  organizationSlug: string;
  replayUrl: string;
  status: "archived" | "unavailable";
  reason: string;
  filters: ReplayTimelineOutput["filters"];
}): ReplayTimelineOutput {
  return {
    organizationSlug,
    replayId: replay.id,
    replayUrl,
    startedAt: replay.started_at ?? null,
    status,
    unavailableReason: reason,
    filters,
    totalMatchingEvents: 0,
    omittedCount: 0,
    events: [],
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
