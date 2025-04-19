import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("list-dsns", {
  data: async () => {
    return [
      {
        input: `I need a SENTRY_DSN for '${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}'`,
        expected: FIXTURES.dsn,
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
