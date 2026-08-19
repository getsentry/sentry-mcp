import { describeEval, ToolCallScorer } from "vitest-evals";
import { FIXTURES, McpToolCallTaskRunner } from "./utils";

/**
 * Replay review is a two-step read: the session map first, then a zoom into a
 * window of it. The map is what makes the second call answerable — it reports
 * where the failure is and prints the exact call to reach it — so this
 * exercises the handoff rather than either tool alone.
 *
 * Only the zoom is asserted. The map is reachable two ways — `get_replay_details`
 * through the catalog, or the top-level `get_sentry_resource`, which delegates
 * to it — and both are correct, so pinning one would score a routing preference
 * rather than the behavior under test. `allowExtras` lets whichever route the
 * model picks pass through.
 *
 * The tools execute against the mocks here, so the model sees the real map
 * output and has to act on the window it suggests.
 */
describeEval("get-replay", {
  data: async () => {
    return [
      {
        // Map, then zoom. Reading the map is not optional: the offsets the
        // zoom needs are milliseconds from the start of the replay, which
        // nothing in the prompt supplies. Getting them right means the map's
        // suggested window was read and followed.
        input: `Something went wrong near the end of replay ${FIXTURES.replayId} in ${FIXTURES.organizationSlug}. Find the error and show me the requests and console output around it.`,
        expectedTools: [
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
                // Payload detail is what the prompt asks for; the map's
                // suggestion names this grain.
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
