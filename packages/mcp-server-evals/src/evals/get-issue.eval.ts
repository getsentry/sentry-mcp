import { describeEval } from "vitest-evals";
import { FIXTURES, NoOpTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("get-issue", {
  data: async () => {
    return [
      {
        input: `Explain CLOUDFLARE-MCP-41 from Sentry in ${FIXTURES.organizationSlug}.`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "get_issue_details",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              issueId: "CLOUDFLARE-MCP-41",
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      {
        input: `Explain the event with ID 7ca573c0f4814912aaa9bdc77d1a7d51 from Sentry in ${FIXTURES.organizationSlug}.`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "get_issue_details",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              eventId: "7ca573c0f4814912aaa9bdc77d1a7d51",
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
    ];
  },
  task: NoOpTaskRunner(),
  scorers: [ToolPredictionScorer()],
  threshold: 0.6,
  timeout: 30000,
});
