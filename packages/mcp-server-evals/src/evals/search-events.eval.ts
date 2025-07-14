import { describeEval } from "vitest-evals";
import { FIXTURES, NoOpTaskRunner, ToolPredictionScorer } from "./utils";

// Note: This eval requires OPENAI_API_KEY to be set in the environment
// The search_events tool uses the AI SDK to translate natural language queries
describeEval("search-events", {
  data: async () => {
    return [
      {
        input: `Find database timeouts in ${FIXTURES.organizationSlug} from the last week`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "database timeouts from the last week",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Search for login failures with 401 errors in production for ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery:
                "login failures with 401 errors in production",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Find slow API calls taking over 5 seconds in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "slow API calls taking over 5 seconds",
              dataset: "spans",
            },
          },
        ],
      },
      {
        input: `Show me authentication errors in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              projectSlug: FIXTURES.projectSlug,
              naturalLanguageQuery: "authentication errors",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Find any timeout errors in the checkout flow for ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "timeout errors in the checkout flow",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Search for server errors (5xx) in the last hour for ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "server errors (5xx) in the last hour",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Find JavaScript errors in production for ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "JavaScript errors in production",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Show me database connection errors affecting users in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery:
                "database connection errors affecting users",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Find all errors affecting david@sentry.io in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "all errors affecting david@sentry.io",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Search for API timeouts in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug} project`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              projectSlug: FIXTURES.projectSlug,
              naturalLanguageQuery: "API timeouts",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: `Can you show me the latest logs on ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "latest logs",
              dataset: "logs",
            },
          },
        ],
      },
      {
        input: `Show me error logs from the last hour in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "error logs from the last hour",
              dataset: "logs",
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
