import { describe, expect, it } from "vitest";
import addIssueNote from "./add-issue-note.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("add_issue_note", () => {
  it("serializes the created note", async () => {
    const result = await addIssueNote.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        issueId: "CLOUDFLARE-MCP-41",
        text: "Investigating with the payments team.",
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Added Note to Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

      **Comment ID**: 12345
      **Type**: note
      **Author**: Test User
      **Created**: 2025-04-14T12:34:56.000Z
      **Text**: Investigating with the payments team.

      ## Response Notes

      - The note is visible in the issue activity feed."
    `);
  });
});
