import { describeEval } from "vitest-evals";
import { FIXTURES, SimpleTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("update-issue", {
  data: async () => {
    return [
      // Core use case: Resolve an issue
      {
        input: `Resolve the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug}. Output only the new status as a single word.`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "update_issue",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              issueId: FIXTURES.issueId,
              status: "resolved",
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      // Core use case: Assign an issue
      {
        input: `Assign the issue ${FIXTURES.issueId} in organization ${FIXTURES.organizationSlug} to 'john.doe'. Output only the assigned username.`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "update_issue",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              issueId: FIXTURES.issueId,
              assignedTo: "john.doe",
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      // Core use case: Using issue URL (alternative input method)
      {
        input: `Resolve the issue at ${FIXTURES.issueUrl}. Output only the new status as a single word.`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "update_issue",
            arguments: {
              issueUrl: FIXTURES.issueUrl,
              status: "resolved",
            },
          },
        ],
      },
    ];
  },
  task: SimpleTaskRunner(),
  scorers: [ToolPredictionScorer()],
  threshold: 0.6,
  timeout: 30000,
});
