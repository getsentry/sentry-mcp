import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner, ToolUsage } from "./utils";

describeEval("list-issues", {
  data: async () => {
    return [
      // Test 1: List common production errors with details
      {
        input: `Can you you give me a list of common production errors, with their stacktrace and a url for more information in ${FIXTURES.organizationSlug}?`,
        expected: [
          "## CLOUDFLARE-MCP-41",
          "- **Error**: Tool list_organizations is already registered",
          "- **Issue ID**: CLOUDFLARE-MCP-41",
          "- **Stacktrace**:",
          "```",
          '"index.js" at line 7809:27',
          '"index.js" at line 8029:24',
          '"index.js" at line 19631:28',
          "```",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
        ].join("\n"),
      },

      // Test 2: Basic summary of top issues
      {
        input: `Give me a summary of my top issues in ${FIXTURES.organizationSlug}`,
        expected: [
          "## CLOUDFLARE-MCP-41",
          "- **Issue ID**: CLOUDFLARE-MCP-41",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
          "",
          "## CLOUDFLARE-MCP-42",
          "- **Issue ID**: CLOUDFLARE-MCP-42",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-42`,
        ].join("\n"),
      },

      // Test 3: Most recent issues
      {
        input: `Find the most recent production issues in ${FIXTURES.organizationSlug}`,
        expected: [
          "## CLOUDFLARE-MCP-41",
          "- **Issue ID**: CLOUDFLARE-MCP-41",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
          "",
          "## CLOUDFLARE-MCP-42",
          "- **Issue ID**: CLOUDFLARE-MCP-42",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-42`,
        ].join("\n"),
      },

      // Test 4: User-specific issues
      {
        input: `What issues are affecting david@sentry.io in ${FIXTURES.organizationSlug}?`,
        expected: `Issues affecting david@sentry.io:

## CLOUDFLARE-MCP-41

- **Issue ID**: CLOUDFLARE-MCP-41
- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
      },
    ];
  },
  task: TaskRunner({ logToolCalls: true }),
  scorers: [ToolUsage("find_issues"), Factuality()],
  threshold: 0.6,
  timeout: 60000,
});
