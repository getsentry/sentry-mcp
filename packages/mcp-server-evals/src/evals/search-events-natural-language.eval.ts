import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner, ToolUsage } from "./utils";

// Note: This eval requires OPENAI_API_KEY to be set in the environment
// The search_events tool uses the AI SDK to translate natural language queries
describeEval("search-events-natural-language", {
  data: async () => {
    return [
      // Test 1: Database performance (spans dataset)
      {
        input: `Find database timeouts in ${FIXTURES.organizationSlug} from the last week`,
        expected: [
          // This should search in spans dataset for database operations with timeouts
          "dataset='spans'",
          "span.op:db",
          "timeout",
          "/explore/traces/",
        ].join("\n"),
      },

      // Test 2: Authentication errors (errors dataset)
      {
        input: `Search for login failures with 401 errors in production for ${FIXTURES.organizationSlug}`,
        expected: [
          // This should search in errors dataset for login failures
          "dataset='errors'",
          "login",
          "401",
          "environment:production",
          "/explore/errors/",
        ].join("\n"),
      },

      // Test 3: API performance (spans dataset)
      {
        input: `Find slow API calls taking over 5 seconds in ${FIXTURES.organizationSlug}`,
        expected: [
          // This should search in spans dataset for slow API operations
          "dataset='spans'",
          "span.duration:>5000",
          "span.op:http",
          "/explore/traces/",
        ].join("\n"),
      },

      // Test 4: User-specific errors
      {
        input: `Find all errors affecting david@sentry.io in ${FIXTURES.organizationSlug}`,
        expected: [
          // This should search in errors dataset for errors affecting a specific user
          "dataset='errors'",
          "user.email:david@sentry.io",
          "/explore/errors/",
        ].join("\n"),
      },

      // Test 5: Logs dataset
      {
        input: `Can you show me the latest logs on ${FIXTURES.organizationSlug}`,
        expected: [
          // This should search in logs dataset
          "dataset='logs'",
          "## Log",
          "/explore/logs/",
        ].join("\n"),
      },
    ];
  },
  task: TaskRunner({ logToolCalls: true }),
  scorers: [ToolUsage("search_events"), Factuality()],
  threshold: 0.6,
  timeout: 60000,
});
