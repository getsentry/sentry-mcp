import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("get-issue", {
  data: async () => {
    return [
      {
        input: `Explain CLOUDFLARE-MCP-41 from Sentry in ${FIXTURES.organizationSlug}.`,
        expected: [
          "## CLOUDFLARE-MCP-41",
          "- **Error**: Tool list_organizations is already registered",
          "- **Issue ID**: CLOUDFLARE-MCP-41",
          "- **Stacktrace**:",
          "```",
          "index.js at line 7809:27",
          '"index.js" at line 8029:24',
          '"index.js" at line 19631:28',
          "```",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
        ].join("\n"),
      },
      {
        input: `Explain the event with ID 7ca573c0f4814912aaa9bdc77d1a7d51 from Sentry in ${FIXTURES.organizationSlug}.`,
        expected: [
          "## 7ca573c0f4814912aaa9bdc77d1a7d51",
          "- **Error**: Tool list_organizations is already registered",
          "- **Issue ID**: CLOUDFLARE-MCP-41",
          "- **Stacktrace**:",
          "```",
          "index.js at line 7809:27",
          '"index.js" at line 8029:24',
          '"index.js" at line 19631:28',
          "```",
          `- **URL**: https://${FIXTURES.organizationSlug}.sentry.io/issues/CLOUDFLARE-MCP-41`,
        ].join("\n"),
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
