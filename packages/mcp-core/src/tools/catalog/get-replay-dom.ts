import { getActiveSpan, setTag } from "@sentry/core";
import {
  MAX_REPLAY_SEGMENTS,
  MAX_REPLAY_SEGMENT_BYTES,
} from "../../api-client";
import type { ReplayRecordingSegmentsResult } from "../../api-client";
import { formatReplayOffset } from "../../internal/replay-events";
import type { DomLens, DomReconstruction } from "../../internal/replay-dom";
import {
  DomReconstructor,
  countDropped,
  renderDomTree,
} from "../../internal/replay-dom";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import {
  assertReplayWithinProjectConstraint,
  resolveReplayParams,
} from "../../internal/tool-helpers/replay";
import { resolveRegionUrlForOrganization } from "../../internal/tool-helpers/resolve-region-url";
import type { ServerContext } from "../../types";
import { z } from "zod";
import {
  ParamOrganizationSlug,
  ParamReplayId,
  ParamRegionUrl,
  ParamReplayUrl,
} from "../../schema";

export default defineTool({
  name: "get_replay_dom",
  skills: ["inspect"],
  requiredScopes: ["org:read", "project:read", "event:read"],
  requiredCapabilities: ["replays"],
  description: [
    "Read the page structure of a Sentry replay at one moment in time.",
    "",
    "USE THIS TOOL WHEN USERS:",
    "- Ask what the page looked like when something failed",
    "- Need to know whether an element existed, was disabled, or was empty",
    "- Want the DOM around an element that was clicked or rage-clicked",
    "",
    "Returns structure only — what the page *was*, not what the user did.",
    "Use `get_replay_activity` for that, and to find the `nodeId` to root at.",
    "",
    "Reach for this when a rage or dead click, a hydration error, or a missing",
    "element needs explaining: those are page-state questions, and no signal",
    "list can answer them. It is the DOM, not a slow paint or a console warning,",
    "that explains why a click did nothing.",
    "`atMs` is milliseconds from the start of the replay and is required.",
    "",
    "Text and form values are masked by the SDK before upload, so this answers",
    "structural questions, not what a user typed.",
    "",
    "<examples>",
    "### What the page looked like when the error fired",
    "```",
    "get_replay_dom(organizationSlug='my-organization', replayId='7e07485f-12f9-416b-8b14-26260799b51f', atMs=181300)",
    "```",
    "",
    "### The subtree around a rage-clicked element",
    "```",
    "get_replay_dom(organizationSlug='my-organization', replayId='7e07485f-12f9-416b-8b14-26260799b51f', atMs=181300, rootNodeId=96, lens='full')",
    "```",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    replayUrl: ParamReplayUrl.optional(),
    organizationSlug: ParamOrganizationSlug.optional(),
    replayId: ParamReplayId.optional(),
    regionUrl: ParamRegionUrl.nullable().optional(),
    atMs: z
      .number()
      .min(0)
      .describe(
        "The moment to reconstruct, in milliseconds from the start of the replay. Required: a structural read has no sensible default moment.",
      ),
    rootNodeId: z
      .number()
      .optional()
      .describe(
        "Render only this node and its descendants. Use the `nodeId` reported by a click signal in `get_replay_activity`.",
      ),
    lens: z
      .enum(["interactive", "full"])
      .default("interactive")
      .describe(
        "`interactive` keeps elements a user can act on plus the ancestors that place them; `full` keeps every element.",
      ),
    maxDepth: z
      .number()
      .min(1)
      .max(200)
      .default(40)
      .describe(
        "How deep to descend. Branches below this are pruned and counted, not silently dropped; their siblings still render. Real pages nest deeply, so lower this only to skim.",
      ),
    maxNodes: z
      .number()
      .min(1)
      .max(2000)
      .default(200)
      .describe(
        "How many elements to render before stopping. This is the real budget on output size; raise it, or pass `rootNodeId`, to see more.",
      ),
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

    const heading = `# Replay ${replay.id} DOM at ${formatReplayOffset(params.atMs)}`;

    if (replay.is_archived === true) {
      return `${heading}\n\nRecording is archived and not available for playback.`;
    }

    const projectId =
      replay.project_id != null ? String(replay.project_id) : null;
    if (!projectId || (replay.count_segments ?? 0) === 0) {
      return `${heading}\n\nNo recording segments are available for this replay.`;
    }

    // Offsets are relative to the replay's own start, matching
    // `get_replay_activity`, but rrweb timestamps are absolute. Without a
    // parseable start there is no way to place `atMs` on the recording, and
    // picking either end of the session would answer a different question
    // than the one asked.
    const startedAtMs = replay.started_at ? Date.parse(replay.started_at) : NaN;
    if (Number.isNaN(startedAtMs)) {
      return `${heading}\n\nThis replay has no usable start time, so an offset cannot be placed on the recording.`;
    }

    const reconstructor = new DomReconstructor({
      atMs: startedAtMs + params.atMs,
    });

    // Stop as soon as a segment carries an event past the target: everything
    // after it would be discarded, and paging the rest of a long session to
    // discard it is the difference between a bounded read and a whole-session
    // one.
    let reachedTarget = false;
    const stats = await apiService.streamReplayRecordingSegments(
      {
        organizationSlug: resolved.organizationSlug,
        projectSlugOrId: projectId,
        replayId: resolved.replayId,
      },
      (segment) => {
        for (const event of segment) {
          if (reconstructor.apply(event) === "past-target") {
            reachedTarget = true;
            return "stop";
          }
        }
      },
    );

    const reconstruction = reconstructor.result(startedAtMs);

    const span = getActiveSpan();
    span?.setAttribute("replay.dom.at_ms", params.atMs);
    span?.setAttribute("replay.dom.lens", params.lens);
    span?.setAttribute("replay.dom.rooted", params.rootNodeId !== undefined);
    span?.setAttribute("replay.dom.nodes", reconstruction.nodes.size);
    span?.setAttribute("replay.dom.mutations", reconstruction.mutationsApplied);
    span?.setAttribute(
      "replay.dom.dropped",
      countDropped(reconstruction.dropped),
    );
    span?.setAttribute("replay.dom.segments_read", stats.segmentsRead);

    // A read that ran out of budget before reaching the target has an
    // incomplete mutation history, and the resulting tree reads exactly like a
    // complete one. Refuse instead, and say what would make the read fit.
    if (stats.truncatedBy !== null) {
      return [
        heading,
        "",
        refusalMessage(stats.truncatedBy, params.atMs, params.rootNodeId),
      ].join("\n");
    }

    if (reconstruction.missingSnapshot) {
      return [
        heading,
        "",
        `No full DOM snapshot appears at or before ${formatReplayOffset(params.atMs)}, so there is no structure to reconstruct from. Try a later \`atMs\`.`,
      ].join("\n");
    }

    const tree = renderDomTree(reconstruction, {
      lens: params.lens as DomLens,
      rootNodeId: params.rootNodeId,
      maxDepth: params.maxDepth,
      maxNodes: params.maxNodes,
    });

    if (tree.rootNotFound) {
      return [
        heading,
        "",
        `Node ${params.rootNodeId} does not exist in the DOM at ${formatReplayOffset(params.atMs)}. It may have been added later or removed earlier; check the offset of the signal the id came from.`,
      ].join("\n");
    }

    span?.setAttribute("gen_ai.tool.call.result.count", tree.nodesRendered);

    return formatDomOutput({
      heading,
      reconstruction,
      tree,
      lens: params.lens,
      rootNodeId: params.rootNodeId,
      reachedTarget,
      atMs: params.atMs,
    });
  },
});

function refusalMessage(
  truncatedBy: NonNullable<ReplayRecordingSegmentsResult["truncatedBy"]>,
  atMs: number,
  rootNodeId?: number,
): string {
  const bound =
    truncatedBy === "segments"
      ? `the first ${MAX_REPLAY_SEGMENTS} segments`
      : `${MAX_REPLAY_SEGMENT_BYTES / (1024 * 1024)}MB of recording data`;

  const lines = [
    `Cannot reconstruct the DOM at ${formatReplayOffset(atMs)}: the read hit ${bound} before reaching that moment.`,
    "",
    "A partial tree is not returned, because it would be indistinguishable from a complete one. What helps:",
    `- An earlier \`atMs\`. Reconstruction cost grows with how far into the recording the moment is.`,
  ];

  if (rootNodeId === undefined) {
    lines.push(
      "- Nothing else, in this case: `rootNodeId` narrows what is rendered, not what must be read.",
    );
  }

  lines.push(
    '- `get_replay_activity` at `grain: "digest"` still works on this replay, and reports what happened without reconstructing structure.',
  );

  return lines.join("\n");
}

function formatDomOutput({
  heading,
  reconstruction,
  tree,
  lens,
  rootNodeId,
  reachedTarget,
  atMs,
}: {
  heading: string;
  reconstruction: DomReconstruction;
  tree: ReturnType<typeof renderDomTree>;
  lens: DomLens;
  rootNodeId?: number;
  reachedTarget: boolean;
  atMs: number;
}): string {
  const lines: string[] = [heading, ""];

  // Fidelity first. A tree assembled from a snapshot that dropped a third of
  // its mutations looks identical to a clean one, and the difference decides
  // whether the answer is usable.
  const mutations = reconstruction.mutationsApplied;
  lines.push(
    `Reconstructed from the snapshot at ${formatReplayOffset(reconstruction.snapshotOffsetMs)}, applying ${mutations.toLocaleString("en-US")} mutation${mutations === 1 ? "" : "s"}.`,
  );

  const droppedTotal = countDropped(reconstruction.dropped);
  if (droppedTotal > 0) {
    const reasons = Object.entries(reconstruction.dropped)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${count} ${reason}`)
      .join(", ");
    lines.push(
      `Dropped ${droppedTotal.toLocaleString("en-US")} operation${droppedTotal === 1 ? "" : "s"} (${reasons}); the structure below may be incomplete.`,
    );
  }

  // The recording ending before `atMs` is not an error, but it does mean the
  // tree is the last state on record rather than the state at the moment
  // asked for.
  if (!reachedTarget) {
    lines.push(
      `The recording ends before ${formatReplayOffset(atMs)}; this is its final state.`,
    );
  }

  lines.push("");

  if (tree.lines.length === 0) {
    lines.push(
      lens === "interactive"
        ? 'No interactive elements are present here. Try `lens: "full"`.'
        : "No elements are present here.",
    );
    return lines.join("\n");
  }

  lines.push("```");
  lines.push(...tree.lines);
  lines.push("```");

  // The two limits call for different fixes, so they are reported separately
  // rather than as one "truncated" line the reader has to guess at.
  if (tree.nodeLimitReached) {
    lines.push("");
    lines.push(
      `Stopped after ${tree.nodesRendered} elements (\`maxNodes\`). To see more: raise \`maxNodes\`, or pass \`rootNodeId\` to render one subtree in full — every line above carries the id to use.`,
    );
  }
  if (tree.depthLimitedSubtrees > 0) {
    lines.push("");
    lines.push(
      `${tree.depthLimitedSubtrees} subtree${tree.depthLimitedSubtrees === 1 ? "" : "s"} ${tree.depthLimitedSubtrees === 1 ? "was" : "were"} deeper than \`maxDepth\` and ${tree.depthLimitedSubtrees === 1 ? "is" : "are"} not shown. Raise \`maxDepth\`, or root at the deepest node shown to continue from there.`,
    );
  }

  if (rootNodeId === undefined && lens === "interactive") {
    lines.push("");
    lines.push(
      'Showing interactive elements and their ancestors. Pass `rootNodeId` to focus a subtree, or `lens: "full"` for every element.',
    );
  }

  return lines.join("\n");
}
