import { describeEval } from "vitest-evals";
import { FIXTURES, SimpleTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("list-organizations", {
  data: async () => {
    return [
      {
        input: `What organizations do I have access to in Sentry`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
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
