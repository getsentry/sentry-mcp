import { setTag } from "@sentry/core";
import type { ReplayDetails, ReplayRecordingSegments } from "../api-client";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
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

export default defineTool({
  name: "get_replay_details",
  skills: ["inspect"],
  requiredScopes: ["event:read"],
  requiredCapabilities: ["replays"],
  hideInExperimentalMode: true,
  description: [
    "Get detailed information about a specific Sentry replay by URL or replay ID.",
    "",
    "USE THIS TOOL WHEN USERS:",
    "- Share a replay URL",
    "- Ask what happened in a specific replay",
    "- Want replay overview details and a concise activity timeline",
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

    let segments: ReplayRecordingSegments | null = null;
    let segmentsError: string | null = null;

    const isArchived = replay.is_archived === true;
    const projectId =
      replay.project_id !== null && replay.project_id !== undefined
        ? String(replay.project_id)
        : null;
    const hasSegments = (replay.count_segments ?? 0) > 0;

    if (!isArchived && projectId && hasSegments) {
      try {
        segments = await apiService.getReplayRecordingSegments({
          organizationSlug: resolved.organizationSlug,
          projectSlugOrId: projectId,
          replayId: resolved.replayId,
        });
      } catch (error) {
        segmentsError =
          error instanceof Error
            ? error.message
            : "Unknown segment download error";
      }
    }

    return formatReplayOutput({
      replay,
      organizationSlug: resolved.organizationSlug,
      replayUrl:
        params.replayUrl ??
        apiService.getReplayUrl(resolved.organizationSlug, replay.id),
      segments,
      segmentsError,
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
}: {
  replay: ReplayDetails;
  organizationSlug: string;
  replayUrl: string;
  segments: ReplayRecordingSegments | null;
  segmentsError: string | null;
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

  lines.push(`# Replay ${replay.id} in **${organizationSlug}**`);
  lines.push("");
  lines.push(`**Replay URL**: ${replayUrl}`);
  lines.push(`**Project ID**: ${replay.project_id ?? "Unknown"}`);
  lines.push(`**Started**: ${replay.started_at ?? "Unknown"}`);
  lines.push(`**Finished**: ${replay.finished_at ?? "Unknown"}`);
  if (replay.duration !== null && replay.duration !== undefined) {
    lines.push(`**Duration**: ${formatDurationSeconds(replay.duration)}`);
  }
  lines.push(`**Archived**: ${isArchived ? "Yes" : "No"}`);
  lines.push("");

  lines.push("## Session");
  lines.push("");
  lines.push(`- **User**: ${user}`);
  lines.push(`- **Environment**: ${replay.environment ?? "Unknown"}`);
  lines.push(`- **Platform**: ${replay.platform ?? "Unknown"}`);
  lines.push(
    `- **Browser**: ${formatNameVersion(replay.browser?.name, replay.browser?.version)}`,
  );
  lines.push(
    `- **OS**: ${formatNameVersion(replay.os?.name, replay.os?.version)}`,
  );
  lines.push(`- **Device**: ${device}`);
  lines.push(
    `- **SDK**: ${formatNameVersion(replay.sdk?.name, replay.sdk?.version)}`,
  );

  lines.push("");
  lines.push("## Signals");
  lines.push("");
  lines.push(`- **Errors**: ${replay.count_errors ?? 0}`);
  lines.push(`- **Warnings**: ${replay.count_warnings ?? 0}`);
  lines.push(`- **Infos**: ${replay.count_infos ?? 0}`);
  lines.push(`- **Dead Clicks**: ${replay.count_dead_clicks ?? 0}`);
  lines.push(`- **Rage Clicks**: ${replay.count_rage_clicks ?? 0}`);
  lines.push(`- **Segments**: ${replay.count_segments ?? 0}`);
  lines.push(`- **URLs Visited**: ${replay.count_urls ?? replay.urls.length}`);

  if (replay.urls.length > 0) {
    lines.push("");
    lines.push("## URLs");
    lines.push("");
    for (const url of replay.urls.slice(0, 5)) {
      lines.push(`- ${url}`);
    }
  }

  if (replay.trace_ids.length > 0 || replay.error_ids.length > 0) {
    lines.push("");
    lines.push("## Related IDs");
    lines.push("");
    if (replay.trace_ids.length > 0) {
      lines.push(`- **Trace IDs**: ${replay.trace_ids.join(", ")}`);
    }
    if (replay.error_ids.length > 0) {
      lines.push(`- **Error IDs**: ${replay.error_ids.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("## What Happened");
  lines.push("");

  if (isArchived) {
    lines.push(
      "Replay recording data is archived, so no segment timeline is available.",
    );
  } else if (segments && segments.length > 0) {
    const highlights = summarizeReplaySegments(segments);
    if (highlights.length > 0) {
      for (const highlight of highlights) {
        lines.push(`- ${highlight}`);
      }
    } else {
      lines.push(
        `Downloaded ${segments.length} replay segment(s), but they did not contain recognizable high-signal events.`,
      );
    }
  } else if (segmentsError) {
    lines.push(
      `Replay details loaded, but the deeper recording data could not be fetched: ${segmentsError}`,
    );
  } else if ((replay.count_segments ?? 0) === 0) {
    lines.push("This replay does not have any recording segments.");
  } else {
    lines.push("Replay details loaded, but no segment data was available.");
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

function formatNameVersion(
  name?: string | null,
  version?: string | null,
): string {
  if (name && version) {
    return `${name} ${version}`;
  }
  return name ?? version ?? "Unknown";
}

function summarizeReplaySegments(segments: ReplayRecordingSegments): string[] {
  const highlights: string[] = [];

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]!;
    for (const event of segment) {
      const highlight = summarizeReplayEvent(event, segmentIndex);
      if (highlight) {
        highlights.push(highlight);
      }
      if (highlights.length >= 12) {
        return highlights;
      }
    }
  }

  return highlights;
}

function summarizeReplayEvent(
  event: unknown,
  segmentIndex: number,
): string | null {
  if (!isRecord(event)) {
    return null;
  }

  const timestamp = formatEventTimestamp(event.timestamp);
  const data = isRecord(event.data) ? event.data : null;
  const tag = typeof data?.tag === "string" ? data.tag : "";
  const payload = isRecord(data?.payload) ? data.payload : null;

  if (tag) {
    const primary =
      tag === "performanceSpan"
        ? (firstString(payload?.op, payload?.description) ?? "operation")
        : tag;
    const detail =
      tag === "performanceSpan"
        ? firstString(payload?.description)
        : (firstString(
            payload?.message,
            payload?.description,
            payload?.category,
            payload?.type,
          ) ?? summarizeObject(payload));
    const duration =
      tag === "performanceSpan" &&
      isRecord(payload?.data) &&
      typeof payload.data.duration === "number"
        ? ` (${payload.data.duration}ms)`
        : "";

    return `${timestamp} segment ${segmentIndex}: ${primary}${detail && detail !== primary ? ` - ${detail}` : ""}${duration}`;
  }

  if (typeof event.type === "number" && data) {
    const href = typeof data.href === "string" ? data.href : null;
    if (href) {
      return `${timestamp} segment ${segmentIndex}: view loaded ${href}`;
    }
  }

  return null;
}

function formatEventTimestamp(value: unknown): string {
  if (typeof value !== "number") {
    return "Unknown time";
  }
  const millis = value > 1e12 ? value : value * 1000;
  return new Date(millis).toISOString();
}

function summarizeObject(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries = Object.entries(value)
    .filter(
      ([, nested]) => typeof nested === "string" || typeof nested === "number",
    )
    .slice(0, 3)
    .map(([key, nested]) => `${key}=${nested}`);
  return entries.length > 0 ? entries.join(", ") : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
