import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("update-issue-assignment", {
  data: async () => {
    return [
      {
        input: `Assign the issue '${FIXTURES.issueId}' in organization '${FIXTURES.organizationSlug}' to user 'john.doe@example.com'. Output **only** the assigned user email in the format:\n<ASSIGNED_TO>`,
        expected: "john.doe@example.com",
      },
      {
        input: `Assign the issue '${FIXTURES.issueId}' in organization '${FIXTURES.organizationSlug}' to the team 'backend-team'. Output **only** the team slug in the format:\n<ASSIGNED_TO>`,
        expected: "backend-team",
      },
      {
        input: `Update the assignment of issue '${FIXTURES.issueId}' in organization '${FIXTURES.organizationSlug}' to user 'jane.smith@company.com'. Output **only** the assigned user email in the format:\n<ASSIGNED_TO>`,
        expected: "jane.smith@company.com",
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
