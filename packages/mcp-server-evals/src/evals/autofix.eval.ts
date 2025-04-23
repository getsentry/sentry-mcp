import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("begin-autofix", {
  data: async () => {
    return [
      {
        input: `Whats the status on root causing this issue in Sentry?\n${FIXTURES.autofixIssueUrl}`,
        expected:
          'Batched TRPC request incorrectly passed bottle ID 3216 to `bottleById`, instead of 16720, resulting in a "Bottle not found" error.',
      },
      {
        input: `Can you root cause this issue and retrieve the analysis?\n${FIXTURES.autofixIssueUrl}`,
        expected:
          'Batched TRPC request incorrectly passed bottle ID 3216 to `bottleById`, instead of 16720, resulting in a "Bottle not found" error.',
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
