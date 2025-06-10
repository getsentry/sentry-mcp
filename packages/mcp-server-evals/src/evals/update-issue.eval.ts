import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("update-issue", {
  data: async () => {
    return [
      // Test resolving an issue
      {
        input: `Resolve the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug}. Output **only** the new status in the format:\n<STATUS>`,
        expected: "resolved",
      },
      // Test assigning an issue
      {
        input: `Assign the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} to 'john.doe'. Output **only** the assigned user in the format:\n<ASSIGNED_TO>`,
        expected: "john.doe",
      },
      // Test assigning to self
      {
        input: `Assign the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} to myself. Output **only** the assigned user in the format:\n<ASSIGNED_TO>`,
        expected: "me",
      },
      // Test setting status to ignored
      {
        input: `Mark the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} as ignored. Output **only** the new status in the format:\n<STATUS>`,
        expected: "ignored",
      },
      // Test resolving and assigning in one action
      {
        input: `Resolve the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} and assign it to 'jane.smith'. Output the status and assignee in the format:\n<STATUS>|<ASSIGNED_TO>`,
        expected: "resolved|jane.smith",
      },
      // Test using issue URL instead of org + issue ID
      {
        input: `Resolve the issue at ${FIXTURES.issueUrl}. Output **only** the new status in the format:\n<STATUS>`,
        expected: "resolved",
      },
      // Test reopening an issue (setting to unresolved)
      {
        input: `Reopen the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} by marking it as unresolved. Output **only** the new status in the format:\n<STATUS>`,
        expected: "unresolved",
      },
      // Test workflow: find issue, then update it
      {
        input: `First find issues in organization ${FIXTURES.organizationSlug} that are unresolved, then resolve the issue ${FIXTURES.issueId}. Output **only** the final status of ${FIXTURES.issueId} in the format:\n<STATUS>`,
        expected: "resolved",
      },
      // Test resolving for next release
      {
        input: `Mark the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} as resolved in the next release. Output **only** the new status in the format:\n<STATUS>`,
        expected: "resolvedInNextRelease",
      },
      // Test team assignment workflow
      {
        input: `Assign the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} to the team '${FIXTURES.teamSlug}'. Output **only** the assigned team in the format:\n<ASSIGNED_TO>`,
        expected: FIXTURES.teamSlug,
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
