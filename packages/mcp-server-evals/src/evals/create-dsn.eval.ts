import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("create-project", {
  data: async () => {
    return [
      {
        input: `Create a new SENTRY_DSN for '${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}'`,
        expected: FIXTURES.dsn,
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
