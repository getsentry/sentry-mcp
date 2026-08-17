import { getActiveSpan, setTag } from "@sentry/core";
import type { ReplayRecordingSegmentsResult } from "../../api-client";
import {
  MAX_REPLAY_SEGMENTS,
  MAX_REPLAY_SEGMENT_BYTES,
} from "../../api-client";
import type { ReplayGrain, ReplaySignal } from "../../internal/replay-events";
import {
  REPLAY_SIGNAL_KINDS,
  extractReplaySignals,
  formatReplayOffset,
  renderReplaySignals,
} from "../../internal/replay-events";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import {
  assertReplayWithinProjectConstraint,
  resolveReplayParams,
} from "../../internal/tool-helpers/replay";
import { resolveRegionUrlForOrganization } from "../../internal/tool-helpers/resolve-region-url";
import { UserInputError } from "../../errors";
import type { ServerContext } from "../../types";
import { z } from "zod";
import {
  ParamOrganizationSlug,
  ParamReplayId,
  ParamRegionUrl,
  ParamReplayUrl,
} from "../../schema";

/**
 * Encodes the query a cursor continues.
 *
 * Sentry paginates recording segments, not signals, so there is no server-side
 * signal cursor to pass through. This cursor is synthetic: each page re-reads
 * the recording and skips `offset` matching signals. It carries the window and
 * the kind filter so that continuing a page yields a stable continuation of the
 * same query rather than a differently-filtered one.
 */
interface ActivityCursor {
  startMs?: number;
  endMs?: number;
  kinds?: string[];
  offset: number;
}

const DEFAULT_LIMIT = 50;

export default defineTool({
  name: "get_replay_activity",
  skills: ["inspect"],
  requiredScopes: ["org:read", "project:read", "event:read"],
  requiredCapabilities: ["replays"],
  description: [
    "Read what happened during a window of a Sentry replay session.",
    "",
    "USE THIS TOOL WHEN USERS:",
    "- Ask what happened around a specific moment in a replay",
    "- Need the requests, clicks, or console output behind a replay failure",
    "- Want more or less detail than the replay map provides",
    "",
    "Call `get_replay_details` first for the session map; it suggests a window.",
    "Offsets are milliseconds from the start of the replay.",
    "",
    "<examples>",
    "### Zoom into a failure",
    "```",
    "get_replay_activity(organizationSlug='my-organization', replayId='7e07485f-12f9-416b-8b14-26260799b51f', startMs=306000, endMs=316000, grain='detail')",
    "```",
    "",
    "### Cheap shape check on a long session",
    "```",
    "get_replay_activity(replayUrl='https://my-organization.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/', grain='digest', kinds=['network','console'])",
    "```",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    replayUrl: ParamReplayUrl.optional(),
    organizationSlug: ParamOrganizationSlug.optional(),
    replayId: ParamReplayId.optional(),
    regionUrl: ParamRegionUrl.nullable().optional(),
    startMs: z
      .number()
      .min(0)
      .optional()
      .describe(
        "Window start, in milliseconds from the start of the replay. Omit for the whole session.",
      ),
    endMs: z
      .number()
      .min(0)
      .optional()
      .describe(
        "Window end, in milliseconds from the start of the replay. Omit for the whole session.",
      ),
    grain: z
      .enum(["digest", "standard", "detail"])
      .default("standard")
      .describe(
        "How much to render per signal: `digest` is one rollup line per kind, `standard` one line per signal, `detail` adds payload such as status codes and durations.",
      ),
    kinds: z
      .array(z.enum(REPLAY_SIGNAL_KINDS))
      .optional()
      .describe(
        "Only return these kinds of signal. Omit to include everything.",
      ),
    limit: z.number().min(1).max(200).default(DEFAULT_LIMIT),
    cursor: z
      .string()
      .optional()
      .describe("Continue a truncated result, using the cursor it returned."),
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

    // A cursor fully describes the query it continues, so it overrides any
    // window or filter passed alongside it. Honouring both would silently
    // change what the caller is paging through.
    const cursor = params.cursor ? decodeCursor(params.cursor) : null;
    const startMs = cursor ? cursor.startMs : params.startMs;
    const endMs = cursor ? cursor.endMs : params.endMs;
    const kinds = cursor ? cursor.kinds : params.kinds;
    const offset = cursor?.offset ?? 0;

    if (startMs !== undefined && endMs !== undefined && endMs < startMs) {
      throw new UserInputError(
        "`endMs` must be greater than or equal to `startMs`.",
      );
    }

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

    if (replay.is_archived === true) {
      return `# Replay ${replay.id} activity\n\nRecording is archived and not available for playback.`;
    }

    const projectId =
      replay.project_id != null ? String(replay.project_id) : null;
    if (!projectId || (replay.count_segments ?? 0) === 0) {
      return `# Replay ${replay.id} activity\n\nNo recording segments are available for this replay.`;
    }

    const recording = await apiService.getReplayRecordingSegments({
      organizationSlug: resolved.organizationSlug,
      projectSlugOrId: projectId,
      replayId: resolved.replayId,
    });

    const allSignals = extractReplaySignals(recording.segments, {
      startedAt: replay.started_at,
      platform: replay.platform,
    });
    const matching = allSignals.filter((signal) =>
      matchesQuery(signal, { startMs, endMs, kinds }),
    );
    const page = matching.slice(offset, offset + params.limit);

    const span = getActiveSpan();
    span?.setAttribute("replay.grain", params.grain);
    span?.setAttribute("replay.kinds", (kinds ?? []).join(",") || "all");
    span?.setAttribute(
      "replay.window_ms",
      startMs !== undefined || endMs !== undefined
        ? (endMs ?? Number.POSITIVE_INFINITY) - (startMs ?? 0)
        : -1,
    );
    span?.setAttribute("replay.signals_matched", matching.length);
    span?.setAttribute("gen_ai.tool.call.result.count", page.length);

    return formatActivityOutput({
      replayId: replay.id,
      signals: page,
      matchedCount: matching.length,
      offset,
      limit: params.limit,
      grain: params.grain,
      startMs,
      endMs,
      kinds,
      truncatedBy: recording.truncatedBy,
    });
  },
});

function matchesQuery(
  signal: ReplaySignal,
  {
    startMs,
    endMs,
    kinds,
  }: { startMs?: number; endMs?: number; kinds?: string[] },
): boolean {
  if (kinds && kinds.length > 0 && !kinds.includes(signal.kind)) {
    return false;
  }

  if (startMs === undefined && endMs === undefined) {
    return true;
  }

  // A signal whose timestamp could not be resolved cannot be placed in a
  // window, so it is excluded from windowed queries rather than guessed into
  // one. It remains available in a whole-session read.
  if (signal.offsetMs === null) {
    return false;
  }

  if (startMs !== undefined && signal.offsetMs < startMs) {
    return false;
  }
  if (endMs !== undefined && signal.offsetMs > endMs) {
    return false;
  }
  return true;
}

function formatActivityOutput({
  replayId,
  signals,
  matchedCount,
  offset,
  limit,
  grain,
  startMs,
  endMs,
  kinds,
  truncatedBy,
}: {
  replayId: string;
  signals: ReplaySignal[];
  matchedCount: number;
  offset: number;
  limit: number;
  grain: ReplayGrain;
  startMs?: number;
  endMs?: number;
  kinds?: string[];
  truncatedBy: ReplayRecordingSegmentsResult["truncatedBy"];
}): string {
  const lines: string[] = [];
  const window =
    startMs !== undefined || endMs !== undefined
      ? `${formatReplayOffset(startMs ?? 0)}–${endMs !== undefined ? formatReplayOffset(endMs) : "end"}`
      : "whole session";

  lines.push(`# Replay ${replayId} activity`);
  lines.push("");
  lines.push(
    `Window: ${window}${kinds?.length ? ` · kinds: ${kinds.join(", ")}` : ""}`,
  );
  lines.push("");

  if (signals.length === 0) {
    lines.push(
      matchedCount === 0
        ? "No signals matched."
        : "No further signals in this window.",
    );
  } else {
    lines.push(...renderReplaySignals(signals, grain));
  }

  // Truncation is always stated, and always with the means to continue.
  const nextOffset = offset + signals.length;
  if (nextOffset < matchedCount) {
    lines.push("");
    lines.push(
      `Showing ${offset + 1}–${nextOffset} of ${matchedCount} matching signals. Continue with:`,
    );
    lines.push(
      `cursor='${encodeCursor({ startMs, endMs, kinds, offset: nextOffset })}'`,
    );
  }

  // A partial recording read is a different kind of gap from a paged result,
  // and hiding it would make a truncated session look complete.
  if (truncatedBy === "segments") {
    lines.push("");
    lines.push(
      `Note: the recording was read up to the first ${MAX_REPLAY_SEGMENTS} segments; later activity is not included.`,
    );
  } else if (truncatedBy === "bytes") {
    lines.push("");
    lines.push(
      `Note: the recording was read up to ${MAX_REPLAY_SEGMENT_BYTES / (1024 * 1024)}MB; later activity is not included.`,
    );
  }

  return lines.join("\n");
}

function encodeCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): ActivityCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new UserInputError(
      "Invalid `cursor`. Use the cursor returned by a previous call.",
    );
  }

  const result = CursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new UserInputError(
      "Invalid `cursor`. Use the cursor returned by a previous call.",
    );
  }
  return result.data;
}

const CursorSchema = z.object({
  startMs: z.number().min(0).optional(),
  endMs: z.number().min(0).optional(),
  kinds: z.array(z.string()).optional(),
  offset: z.number().min(0),
});
