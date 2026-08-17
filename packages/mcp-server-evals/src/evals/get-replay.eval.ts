import { describeEval, ToolCallScorer } from "vitest-evals";
import { FIXTURES, McpToolCallTaskRunner } from "./utils";

/**
 * Replay review is a two-step read: `get_replay_details` returns the session
 * map, and `get_replay_activity` zooms into a window of it. The map is what
 * makes the second call answerable — it reports where the failure is and
 * prints the exact call to reach it — so this exercises the handoff rather
 * than either tool alone.
 *
 * The tools execute against the mocks here, so the model sees the real map
 * output and has to act on the window it suggests.
 */
describeEval("get-replay", {
  data: async () => {
    return [
      {
        // Map first: a replay URL with no stated moment of interest has no
        // window to zoom into yet.
        input: `What happened in this Sentry replay? ${FIXTURES.replayUrl}`,
        expectedTools: [
          {
            name: "search_sentry_tools",
            arguments: {
              query: "replay",
            },
          },
          {
            name: "execute_sentry_tool",
            arguments: {
              name: "get_replay_details",
              arguments: {
                replayUrl: FIXTURES.replayUrl,
              },
            },
          },
        ],
      },
      {
        // Map, then zoom. Reading the map is not optional: the offsets the
        // second call needs are milliseconds from the start of the replay,
        // which nothing in the prompt supplies.
        input: `Something went wrong near the end of replay ${FIXTURES.replayId} in ${FIXTURES.organizationSlug}. Find the error and show me the requests and console output around it.`,
        expectedTools: [
          {
            name: "search_sentry_tools",
            arguments: {
              query: "replay",
            },
          },
          {
            name: "execute_sentry_tool",
            arguments: {
              name: "get_replay_details",
              arguments: {
                organizationSlug: FIXTURES.organizationSlug,
                replayId: FIXTURES.replayId,
              },
            },
          },
          {
            name: "execute_sentry_tool",
            arguments: {
              name: "get_replay_activity",
              arguments: {
                organizationSlug: FIXTURES.organizationSlug,
                replayId: FIXTURES.replayId,
                // The window the map suggests for the fixture's error.
                startMs: 176300,
                endMs: 186300,
                grain: "detail",
              },
            },
          },
        ],
      },
    ];
  },
  task: McpToolCallTaskRunner(),
  scorers: [ToolCallScorer({ ordered: true, params: "fuzzy" })],
  threshold: 0.6,
  timeout: 90000,
});
