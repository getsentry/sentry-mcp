import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner, ToolUsage } from "./utils";

// Core tests for search_events tool covering main datasets and functionality
describeEval("search-events-comprehensive", {
  data: async () => {
    return [
      // Test 1: Logs dataset - error logs
      {
        input: `Show me error logs from the last hour in ${FIXTURES.organizationSlug}`,
        expected: [
          "dataset='logs'",
          "severity:error",
          "/explore/logs/",
          "ERROR: Failed to connect to Redis cache",
          "severity: error",
          "timestamp",
          "## Log Entries",
        ].join("\n"),
      },

      // Test 2: Errors dataset - database errors
      {
        input: `Find database connection errors in ${FIXTURES.organizationSlug}`,
        expected: [
          "dataset='errors'",
          "DatabaseError",
          "Connection timeout",
          "error.type",
          "CLOUDFLARE-MCP",
        ].join("\n"),
      },

      // Test 3: Spans dataset - slow queries
      {
        input: `Find slow database queries taking over 100ms in ${FIXTURES.organizationSlug}`,
        expected: [
          "dataset='spans'",
          "span.op:db.query",
          "span.duration:>100",
          "SELECT * FROM users",
          "INSERT INTO orders",
          "span.duration",
        ].join("\n"),
      },

      // Test 4: Project-specific filtering
      {
        input: `Show me all errors in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug} project`,
        expected: [
          "dataset='errors'",
          "**Project**: cloudflare-mcp",
          "CLOUDFLARE-MCP",
          "project",
        ].join("\n"),
      },

      // Test 5: Production environment filtering
      {
        input: `Find HTTP 500 errors in production for ${FIXTURES.organizationSlug}`,
        expected: [
          "dataset='errors'",
          "500",
          "HTTPError",
          "Internal Server Error",
          "environment:production",
        ].join("\n"),
      },
    ];
  },
  task: TaskRunner({ logToolCalls: true }),
  scorers: [ToolUsage("search_events"), Factuality()],
  threshold: 0.6,
  timeout: 60000,
});
