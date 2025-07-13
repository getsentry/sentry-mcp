import { describeEval } from "vitest-evals";
import { FIXTURES, SimpleTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("list-dsns", {
  data: async () => {
    return [
      {
        input: `What is the SENTRY_DSN for ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}?`,
        expectedTools: [
          {
            name: "find_dsns",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              projectSlug: FIXTURES.projectSlug,
            },
          },
        ],
      },
    ];
  },
  task: SimpleTaskRunner(),
  scorers: [ToolPredictionScorer()],
  threshold: 0.6,
  timeout: 30000,
});
