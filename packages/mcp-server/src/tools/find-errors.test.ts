import { describe, it, expect } from "vitest";
import findErrors from "./find-errors.js";

describe("find_errors", () => {
  it("serializes", async () => {
    const result = await findErrors.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: undefined,
        filename: undefined,
        transaction: undefined,
        query: undefined,
        sortBy: "count",
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Errors in **sentry-mcp-evals**


      ## CLOUDFLARE-MCP-41

      **Description**: Error: Tool list_organizations is already registered
      **Issue ID**: CLOUDFLARE-MCP-41
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41
      **Project**: test-suite
      **Last Seen**: 2025-04-07T12:23:39+00:00
      **Occurrences**: 2

      # Using this information

      - You can reference the Issue ID in commit messages (e.g. \`Fixes <issueID>\`) to automatically close the issue when the commit is merged.
      - You can get more details about an error by using the tool: \`get_issue_details(organizationSlug="sentry-mcp-evals", issueId=<issueID>)\`
      "
    `);
  });
});
