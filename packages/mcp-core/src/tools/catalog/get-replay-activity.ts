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
import {
  formatToolCall,
  formatToolCallInstruction,
} from "../../internal/tool-helpers/tool-call-formatting";
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
    "This answers what *happened*, not what the page *was*. When a click went",
    "unanswered or an element looks wrong, `get_replay_dom` reads the structure",
    "at that moment — this tool reports the `nodeId` to root it at.",
    "Web vitals and console warnings are context, rarely the cause; prefer the",
    "failed request, the unanswered click, or the DOM around it.",
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
      organizationSlug: resolved.organizationSlug,
      context,
    });
  },
});

/**
 * Signals that raise a question about the page, not about a request.
 *
 * A rage or dead click means the user acted and the page did not respond, and a
 * hydration error means the DOM the server sent and the one the client built
 * disagreed. In all three the useful next question is what the element looked
 * like, which the signal list cannot answer. Ordinary clicks and network
 * failures are deliberately excluded: a 500 is explained by the response, and
 * suggesting a structural read after every click would train a reader to ignore
 * the suggestion.
 */
const STRUCTURAL_SIGNAL_TYPES = new Set([
  "rage-click",
  "dead-click",
  "hydration-error",
]);

/**
 * Pick the signal whose structure is worth looking at.
 *
 * Prefers one that names a node, since rooting a read at the element beats
 * rendering the whole page. Falls back to the first structural signal so the
 * offset is still offered when no id came through — real recordings populate
 * `node.id` on most but not all click breadcrumbs.
 */
function findStructuralSignal(signals: ReplaySignal[]): ReplaySignal | null {
  const candidates = signals.filter(
    (signal) =>
      STRUCTURAL_SIGNAL_TYPES.has(signal.type) && signal.offsetMs !== null,
  );
  return (
    candidates.find((signal) => signal.nodeId !== undefined) ??
    candidates[0] ??
    null
  );
}

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
  organizationSlug,
  context,
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
  organizationSlug: string;
  context: ServerContext;
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

  const nextOffset = offset + signals.length;
  const isTruncated = nextOffset < matchedCount;

  // A digest is a rollup, and a rollup of one page reads exactly like a rollup
  // of the session — the counts look authoritative while the failures that
  // decide the answer sit on a later page. Say so above the numbers, not only
  // below them, because the numbers are what gets believed.
  if (isTruncated && grain === "digest" && signals.length > 0) {
    lines.push(
      `**Partial rollup.** These counts cover only signals ${offset + 1}\u2013${nextOffset} of ${matchedCount}, not the whole window. Raise \`limit\` for a complete rollup before drawing conclusions from them.`,
    );
    lines.push("");
  }

  if (signals.length === 0) {
    lines.push(
      matchedCount === 0
        ? "No signals matched."
        : "No further signals in this window.",
    );
  } else {
    lines.push(...renderReplaySignals(signals, grain));
  }

  // Truncation is always stated, and always with the means to continue — as a
  // callable tool call rather than a bare cursor, so continuing does not require
  // reconstructing the call around it.
  if (isTruncated) {
    lines.push("");
    lines.push(
      `Showing ${offset + 1}\u2013${nextOffset} of ${matchedCount} matching signals${offset === 0 ? ` (\`limit\` was ${limit})` : ""}. To continue:`,
    );
    lines.push(
      formatToolCall({
        toolName: "get_replay_activity",
        arguments: {
          organizationSlug,
          replayId,
          cursor: encodeCursor({ startMs, endMs, kinds, offset: nextOffset }),
          grain,
        },
      }),
    );
    lines.push(
      "Or raise `limit` (max 200) to see more at once; a windowed read with `startMs`/`endMs` is cheaper than paging a whole session.",
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

  lines.push(
    ...suggestStructuralRead({ replayId, signals, organizationSlug, context }),
  );

  return lines.join("\n");
}

/**
 * Point at a structural read when a signal raises a question this tool cannot
 * answer.
 *
 * The signal list explains what happened; it cannot say what the page was. When
 * a click went unanswered or hydration disagreed, that second question is the
 * one that matters, and without a printed call the reader has to know a third
 * tool exists and go looking for it. The map already hands this tool its next
 * call the same way, so the chain reads end to end.
 *
 * Deliberately conditional. A suggestion on every response is a suggestion
 * nobody reads, so it appears only for signals whose explanation is structural.
 */
function suggestStructuralRead({
  replayId,
  signals,
  organizationSlug,
  context,
}: {
  replayId: string;
  signals: ReplaySignal[];
  organizationSlug: string;
  context: ServerContext;
}): string[] {
  const instruction = formatToolCallInstruction({
    toolName: "get_replay_dom",
    experimentalMode: context.experimentalMode ?? false,
    availableToolNames: context.availableToolNames,
    directToolNames: context.directToolNames,
    // Silence beats a dangling pointer: if the tool is not in this session,
    // naming it would send the reader after something unreachable.
    fallbackInstruction: "",
    purpose: "to see the page structure at that moment",
  });
  if (!instruction) {
    return [];
  }

  const signal = findStructuralSignal(signals);

  // A specific signal earns a specific, rooted call.
  if (signal && signal.offsetMs !== null) {
    const reason =
      signal.type === "hydration-error"
        ? "A hydration error means the server and client DOM disagreed"
        : "A click the page did not answer is usually explained by the element itself";

    return [
      "",
      `${reason}. ${instruction}:`,
      formatToolCall({
        toolName: "get_replay_dom",
        arguments: {
          organizationSlug,
          replayId,
          atMs: signal.offsetMs,
          ...(signal.nodeId !== undefined ? { rootNodeId: signal.nodeId } : {}),
        },
      }),
    ];
  }

  // Nothing here names an element, but plenty of replay questions are about
  // page state with no signal at all behind them: a message that flashed, a
  // control that was missing, a spinner that never resolved. The signal list
  // cannot answer those, and an agent that does not know a structural read
  // exists will go looking for an explanation in application source instead.
  // So the capability is stated once, without a specific moment to aim at,
  // whenever there is a timeline to aim into.
  // Prefer a failure as the example offset: it is the moment a reader is most
  // likely to ask about, and the first signal in the page is usually a
  // navigation that explains nothing. Falls back to any placed signal so the
  // call is always completable.
  const placed = signals.filter((candidate) => candidate.offsetMs !== null);
  const anchor = placed.find((candidate) => candidate.isError) ?? placed[0];
  if (!anchor || anchor.offsetMs === null) {
    return [];
  }

  return [
    "",
    `If the question is about what the page showed — a message that appeared, a control that was missing or disabled, an element that never rendered — the signals above cannot answer it. ${instruction}, passing the moment you care about:`,
    formatToolCall({
      toolName: "get_replay_dom",
      arguments: { organizationSlug, replayId, atMs: anchor.offsetMs },
    }),
  ];
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
