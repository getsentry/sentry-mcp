import { describe, it, expect } from "vitest";
import findIssues from "./find-issues.js";

describe("find_issues", () => {
  it("serializes with project", async () => {
    const result = await findIssues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        query: undefined,
        sortBy: "last_seen",
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issues in **sentry-mcp-evals/cloudflare-mcp**

      ## CLOUDFLARE-MCP-41

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## CLOUDFLARE-MCP-42

      **Description**: Error: Tool list_issues is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-11T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-42

      # Using this information

      - You can reference the Issue ID in commit messages (e.g. \`Fixes <issueID>\`) to automatically close the issue when the commit is merged.
      - You can get more details about a specific issue by using the tool: \`get_issue_details(organizationSlug="sentry-mcp-evals", issueId=<issueID>)\`
      "
    `);
  });

  it("serializes without project", async () => {
    const result = await findIssues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: undefined,
        query: undefined,
        sortBy: "last_seen",
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issues in **sentry-mcp-evals**

      ## CLOUDFLARE-MCP-41

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## CLOUDFLARE-MCP-42

      **Description**: Error: Tool list_issues is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-11T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-42

      # Using this information

      - You can reference the Issue ID in commit messages (e.g. \`Fixes <issueID>\`) to automatically close the issue when the commit is merged.
      - You can get more details about a specific issue by using the tool: \`get_issue_details(organizationSlug="sentry-mcp-evals", issueId=<issueID>)\`
      "
    `);
  });
});
