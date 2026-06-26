import { mswServer } from "@sentry/mcp-server-mocks";
import { afterEach, describe, expect, it } from "vitest";
import getIssueActivity from "./get-issue-activity.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

afterEach(() => {
  mswServer.resetHandlers();
});

describe("get_issue_activity", () => {
  it("serializes issue activity and comments", async () => {
    const result = await getIssueActivity.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        issueId: "CLOUDFLARE-MCP-41",
        includeComments: true,
        limit: 25,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Activity for Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

      ## Activity

      - 2025-04-10T22:55:22.411Z: auto_set_ongoing by system (4633815464)
        - Data: {"after_days":7}
      - 2025-04-14T12:00:00.000Z: note by Jane Developer (4633816000)
        - Investigating after the latest deploy.

      ## Comments

      - 2025-04-14T12:00:00.000Z: note by Jane Developer (4633816000)
        - Investigating after the latest deploy.

      ## Response Notes

      - Use the Sentry tool \`add_issue_note\` to add a new human-visible issue comment.
      "
    `);
  });

  it("omits add_issue_note guidance when the tool is unavailable", async () => {
    const result = await getIssueActivity.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        issueId: "CLOUDFLARE-MCP-41",
        includeComments: true,
        limit: 25,
      },
      {
        ...context,
        availableToolNames: new Set([
          "get_issue_activity",
          "execute_sentry_tool",
        ]),
        directToolNames: new Set(["execute_sentry_tool"]),
      },
    );

    expect(result).not.toContain("Response Notes");
    expect(result).not.toContain("add_issue_note");
  });
});
