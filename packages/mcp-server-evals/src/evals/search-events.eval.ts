import { describeEval } from "vitest-evals";
import { FIXTURES, NoOpTaskRunner, ToolPredictionScorer } from "./utils";

// Note: This eval requires OPENAI_API_KEY to be set in the environment
// The search_events tool uses the AI SDK to translate natural language queries
describeEval("search-events", {
  data: async () => {
    return [
      {
        input: `Find database timeouts in ${FIXTURES.organizationSlug} from the last week`,
        expected: [
          "## Tool list_organizations is already registered",
          "**Type**: Error",
          "**Issue ID**: CLOUDFLARE-MCP-41",
          `**URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
        ].join("\n"),
      },
      {
        input: `Search for login failures with 401 errors in production for ${FIXTURES.organizationSlug}`,
        expected: [
          "Tool list_organizations is already registered",
          "CLOUDFLARE-MCP-41",
          "Tool list_issues is already registered",
          "CLOUDFLARE-MCP-42",
        ].join("\n"),
      },
      {
        input: `Find slow API calls taking over 5 seconds in ${FIXTURES.organizationSlug}`,
        expected: ["Found 0 event", "No results found"].join("\n"),
      },
      {
        input: `Show me authentication errors in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}`,
        expected: [
          "**Project**: cloudflare-mcp",
          "Tool list_organizations is already registered",
          "CLOUDFLARE-MCP-41",
          "Tool list_issues is already registered",
          "CLOUDFLARE-MCP-42",
        ].join("\n"),
      },
      {
        input: `Find any timeout errors in the checkout flow for ${FIXTURES.organizationSlug}`,
        expected: [
          "Tool list_organizations is already registered",
          "Tool list_issues is already registered",
        ].join("\n"),
      },
      {
        input: `Search for server errors (5xx) in the last hour for ${FIXTURES.organizationSlug}`,
        expected: ["No results found"].join("\n"),
      },
      {
        input: `Find JavaScript errors in production for ${FIXTURES.organizationSlug}`,
        expected: [
          "Tool list_organizations is already registered",
          "CLOUDFLARE-MCP-41",
          "Tool list_issues is already registered",
          "CLOUDFLARE-MCP-42",
        ].join("\n"),
      },
      {
        input: `Show me database connection errors affecting users in ${FIXTURES.organizationSlug}`,
        expected: ["Found 0 event", "No results found"].join("\n"),
      },
      {
        input: `Find all errors affecting david@sentry.io in ${FIXTURES.organizationSlug}`,
        expected: [
          "Tool list_organizations is already registered",
          "CLOUDFLARE-MCP-41",
        ].join("\n"),
      },
      {
        input: `Search for API timeouts in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug} project`,
        expected: ["**Project**: cloudflare-mcp", "Found 0 event"].join("\n"),
      },
      {
        input: `Can you show me the latest logs on ${FIXTURES.organizationSlug}`,
        expected: [
          "Found 0 log",
          "No results found",
          "/explore/logs/",
          "## Log Entries",
          "## Rendering Suggestions",
          "**For AI Agents**: Display logs in a terminal/console-like format",
        ].join("\n"),
      },
      {
        input: `Show me error logs from the last hour in ${FIXTURES.organizationSlug}`,
        expected: [
          "severity:error",
          "/explore/logs/",
          "Found 0 log",
          "## Log Entries",
          "## Rendering Suggestions",
        ].join("\n"),
      },
    ];
  },
  task: NoOpTaskRunner(),
  scorers: [ToolPredictionScorer()],
  threshold: 0.6,
  timeout: 30000,
});
