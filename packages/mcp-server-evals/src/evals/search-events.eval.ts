import { describeEval } from "vitest-evals";
import { FIXTURES, NoOpTaskRunner, ToolPredictionScorer } from "./utils";

// Note: This eval requires OPENAI_API_KEY to be set in the environment
// The search_events tool uses the AI SDK to translate natural language queries
describeEval("search-events", {
  data: async () => {
    return [
      // Core test: Basic error event search
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
      // Core test: Performance spans search
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
      // Core test: Logs search
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
      // Core test: Project-specific search
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
      // Core test: Search with 'me' reference
      {
        input: `Show me errors affecting me in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "whoami",
            arguments: {},
          },
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "errors affecting user.id:12345",
              dataset: "errors",
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
