import { describeEval } from "vitest-evals";
import {
  FIXTURES,
  NoOpTaskRunner,
  ToolPredictionScorer,
  AgentModeTaskRunner,
  SemanticSimilarityScorer,
  ErrorHandlingScorer,
} from "./utils";

// Shared test data for both direct and agent mode
const testData = async () => {
  return [
    {
      input: `What are the most common production errors in ${FIXTURES.organizationSlug}?`,
      expectedTools: [
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
      expectedTools: [
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
      expectedTools: [
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
      expectedTools: [
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
      expectedTools: [
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
};

// Direct mode eval - tests tool prediction
describeEval("list-issues (direct)", {
  data: testData,
  task: NoOpTaskRunner(),
  scorers: [ToolPredictionScorer()],
  threshold: 0.6,
  timeout: 30000,
});

// Agent mode eval - tests actual execution through use_sentry
// Validates output quality via LLM-as-a-judge, not tool calls
describeEval("list-issues (agent)", {
  data: testData,
  task: AgentModeTaskRunner(),
  scorers: [
    SemanticSimilarityScorer(), // Validates output quality
    ErrorHandlingScorer(), // Validates error handling
  ],
  threshold: 0.7,
  timeout: 60000, // Agent mode needs more time for actual execution
});
