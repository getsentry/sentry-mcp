import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("list-organizations", {
  data: async () => {
    return [
      {
        input: `What organizations do I have access to in Sentry`,
        expected: FIXTURES.organizationSlug,
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
