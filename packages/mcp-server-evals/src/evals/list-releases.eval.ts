import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("list-releases", {
  data: async () => {
    return [
      {
        input: `Show me the releases in ${FIXTURES.organizationSlug}`,
        expected: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
      },
      {
        input: `Show me a list of versions in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}`,
        expected: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
