import { describeEval } from "vitest-evals";
import { FIXTURES, NoOpTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("list-organizations", {
  data: async () => {
    return [
      {
        input: `What organizations do I have access to in Sentry`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
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
