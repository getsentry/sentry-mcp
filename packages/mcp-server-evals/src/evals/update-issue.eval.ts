import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("update-issue", {
  data: async () => {
    return [
      // Core use case: Resolve an issue
      {
        input: `Resolve the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug}. Output **only** the new status in the format:\n<STATUS>`,
        expected: "resolved",
      },
      // Core use case: Assign an issue
      {
        input: `Assign the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} to 'john.doe'. Output **only** the assigned user in the format:\n<ASSIGNED_TO>`,
        expected: "john.doe",
      },
      // Core use case: Using issue URL (alternative input method)
      {
        input: `Resolve the issue at ${FIXTURES.issueUrl}. Output **only** the new status in the format:\n<STATUS>`,
        expected: "resolved",
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
