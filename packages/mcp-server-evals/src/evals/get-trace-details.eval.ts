import { describeEval } from "vitest-evals";
import { FIXTURES, NoOpTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("get-trace-details", {
  data: async () => {
    return [
      {
        input: `Show me trace ${FIXTURES.traceId} from Sentry in ${FIXTURES.organizationSlug}.`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "get_trace_details",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              traceId: FIXTURES.traceId,
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      {
        input: `Explain trace ${FIXTURES.traceId} in ${FIXTURES.organizationSlug}.`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "get_trace_details",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              traceId: FIXTURES.traceId,
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
    ];
  },
  task: NoOpTaskRunner(),
  scorers: [ToolPredictionScorer()],
  threshold: 0.6,
  timeout: 30000,
});
