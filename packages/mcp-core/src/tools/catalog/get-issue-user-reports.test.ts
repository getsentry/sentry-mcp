import { mswServer } from "@sentry/mcp-server-mocks";
import { afterEach, describe, expect, it } from "vitest";
import getIssueUserReports from "./get-issue-user-reports.js";

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

describe("get_issue_user_reports", () => {
  it("serializes user feedback for an issue", async () => {
    const result = await getIssueUserReports.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        issueId: "CLOUDFLARE-MCP-41",
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# User Feedback for Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

      - 2026-06-22T02:37:27.878Z by Pragyan Patidar:
        - "i am currently testing it"
      "
    `);
  });
});
