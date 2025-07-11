import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner, ToolUsage } from "./utils";

describeEval("update-issue", {
  data: async () => {
    return [
      // Core use case: Resolve an issue
      {
        input: `Resolve the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug}. Output only the new status as a single word.`,
        expected: "resolved",
      },
      // Core use case: Assign an issue
      {
        input: `Assign the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} to 'john.doe'. Output only the assigned username.`,
        expected: "john.doe",
      },
      // Core use case: Using issue URL (alternative input method)
      {
        input: `Resolve the issue at ${FIXTURES.issueUrl}. Output only the new status as a single word.`,
        expected: "resolved",
      },
    ];
  },
  task: TaskRunner(),
  scorers: [ToolUsage("update_issue"), Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
