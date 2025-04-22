import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("create-team", {
  data: async () => {
    return [
      {
        input: `Create a new team in Sentry for '${FIXTURES.organizationSlug}' called 'the-goats' response with **only** the team slug and no other text.`,
        expected: FIXTURES.teamSlug,
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
