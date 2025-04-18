import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("list-issues", {
  data: async () => {
    return [
      {
        input:
          "Can you you give me a list of common production errors, with their stacktrace and a url for more information?",
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
      {
        input: `Find the newest production issues in ${FIXTURES.organizationSlug}`,
        expected: [
          "## CLOUDFLARE-MCP-42",
          "- **Issue ID**: CLOUDFLARE-MCP-42",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-42`,
          "",
          "## CLOUDFLARE-MCP-41",
          "- **Issue ID**: CLOUDFLARE-MCP-41",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
        ].join("\n"),
      },
      {
        input: `What issues are affecting david@sentry.io in ${FIXTURES.organizationSlug}?`,
        expected: [
          "## CLOUDFLARE-MCP-41",
          "- **Issue ID**: CLOUDFLARE-MCP-41",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
        ].join("\n"),
      },
      {
        input: `How many issues are affecting david@sentry.io in ${FIXTURES.organizationSlug}?`,
        expected: "1",
      },
      {
        input: `How many issues are in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}?`,
        expected: "2",
      },
      {
        input: `What issues are affecting jane@sentry.io in ${FIXTURES.organizationSlug}?`,
        expected: "No issues found",
      },
      {
        input: `How many issues are affecting jane@sentry.io in ${FIXTURES.organizationSlug}?`,
        expected: "0",
      },
      {
        input: `How many issues are in ${FIXTURES.organizationSlug}/foobar?`,
        expected: "0",
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
