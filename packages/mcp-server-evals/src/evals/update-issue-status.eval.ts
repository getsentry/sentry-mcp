import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("update-issue-status", {
  data: async () => {
    return [
      {
        input: `Mark the issue '${FIXTURES.issueId}' in organization '${FIXTURES.organizationSlug}' as resolved. Output **only** the new status in the format:\n<STATUS>`,
        expected: "resolved",
      },
      {
        input: `Update the status of issue '${FIXTURES.issueId}' in organization '${FIXTURES.organizationSlug}' to ignored. Output **only** the status in the format:\n<STATUS>`,
        expected: "ignored",
      },
      {
        input: `Change the status of issue '${FIXTURES.issueId}' in organization '${FIXTURES.organizationSlug}' to unresolved. Output **only** the new status in the format:\n<STATUS>`,
        expected: "unresolved",
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
