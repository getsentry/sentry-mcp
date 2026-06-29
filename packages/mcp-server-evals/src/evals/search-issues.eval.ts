import { FIXTURES, defineToolPredictionEval } from "./utils";

// Note: This eval requires a configured embedded-agent provider key, such as OPENROUTER_API_KEY
// The search_issues tool uses the AI SDK to translate natural language queries
defineToolPredictionEval("search-issues", [
  // Core test: Basic issue search
  {
    input: `Show me unresolved issues in ${FIXTURES.organizationSlug}`,
    expectedTools: [
      {
        name: "find_organizations",
        arguments: {},
      },
      {
        name: "search_issues",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          query: "unresolved issues",
        },
      },
    ],
  },
  // Core test: Search with 'me' reference (tests whoami integration)
  {
    input: `Find issues assigned to me in ${FIXTURES.organizationSlug}`,
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
        name: "search_issues",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          query: "issues assigned to me",
        },
      },
    ],
  },
  // Core test: Project-specific search
  {
    input: `Search for database errors in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}`,
    expectedTools: [
      {
        name: "find_organizations",
        arguments: {},
      },
      {
        name: "search_issues",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          projectSlugOrId: FIXTURES.projectSlug,
          query: "database errors",
        },
      },
    ],
  },
  // Core test: Complex natural language query
  {
    input: `Find critical production errors affecting more than 100 users in ${FIXTURES.organizationSlug}`,
    expectedTools: [
      {
        name: "find_organizations",
        arguments: {},
      },
      {
        name: "search_issues",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          query: "critical production errors affecting more than 100 users",
        },
      },
    ],
  },
]);
