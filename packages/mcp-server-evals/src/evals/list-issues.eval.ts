import { describeEval } from "vitest-evals";
import { FIXTURES, NoOpTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("list-issues", {
  data: async () => {
    return [
      {
        input: `What are the most common production errors in ${FIXTURES.organizationSlug}?`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "find_issues",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              query: "is:unresolved",
              sortBy: "count",
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      {
        input: `Show me the top issues in ${FIXTURES.organizationSlug} organization`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "find_issues",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              sortBy: "count",
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      {
        input: `What are the most recent issues in ${FIXTURES.organizationSlug}?`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "find_issues",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              sortBy: "last_seen",
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      {
        input: `Find the newest production issues in ${FIXTURES.organizationSlug}`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "find_issues",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              sortBy: "first_seen",
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      {
        input: `What issues is david@sentry.io experiencing in ${FIXTURES.organizationSlug}?`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "find_issues",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              query: "user.email:david@sentry.io",
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
