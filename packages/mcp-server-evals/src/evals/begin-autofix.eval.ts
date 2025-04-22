import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("begin-autofix", {
  data: async () => {
    return [
      {
        input: `Can you root cause this issue in Sentry?\n${FIXTURES.issueUrl}`,
        expected: "The analysis has started\n.Run ID: 123",
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
