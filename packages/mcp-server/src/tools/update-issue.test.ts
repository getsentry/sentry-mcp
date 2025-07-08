import { describe, it, expect } from "vitest";
import updateIssue from "./update-issue.js";

describe("update_issue", () => {
  it("updates issue status", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 Updated in **sentry-mcp-evals**

      **Issue**: Error: Tool list_organizations is already registered
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Changes Made

      **Status**: unresolved → **resolved**

      ## Current Status

      **Status**: resolved
      **Assigned To**: Unassigned

      # Using this information

      - The issue has been successfully updated in Sentry
      - You can view the issue details using: \`get_issue_details(organizationSlug="sentry-mcp-evals", issueId="CLOUDFLARE-MCP-41")\`
      - The issue is now marked as resolved and will no longer generate alerts
      "
    `);
  });

  it("updates issue assignment", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: undefined,
        assignedTo: "john.doe",
        issueUrl: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 Updated in **sentry-mcp-evals**

      **Issue**: Error: Tool list_organizations is already registered
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Changes Made

      **Assigned To**: Unassigned → **john.doe**

      ## Current Status

      **Status**: unresolved
      **Assigned To**: john.doe

      # Using this information

      - The issue has been successfully updated in Sentry
      - You can view the issue details using: \`get_issue_details(organizationSlug="sentry-mcp-evals", issueId="CLOUDFLARE-MCP-41")\`
      "
    `);
  });

  it("updates both status and assignment", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: "me",
        issueUrl: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 Updated in **sentry-mcp-evals**

      **Issue**: Error: Tool list_organizations is already registered
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Changes Made

      **Status**: unresolved → **resolved**
      **Assigned To**: Unassigned → **You**

      ## Current Status

      **Status**: resolved
      **Assigned To**: me

      # Using this information

      - The issue has been successfully updated in Sentry
      - You can view the issue details using: \`get_issue_details(organizationSlug="sentry-mcp-evals", issueId="CLOUDFLARE-MCP-41")\`
      - The issue is now marked as resolved and will no longer generate alerts
      "
    `);
  });

  it("validates required parameters", async () => {
    await expect(
      updateIssue.handler(
        {
          organizationSlug: undefined,
          issueId: undefined,
          status: undefined,
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: undefined,
        },
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow("Either `issueId` or `issueUrl` must be provided");
  });

  it("validates organization slug when using issueId", async () => {
    await expect(
      updateIssue.handler(
        {
          organizationSlug: undefined,
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: undefined,
        },
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow(
      "`organizationSlug` is required when providing `issueId`",
    );
  });

  it("validates update parameters", async () => {
    await expect(
      updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: undefined,
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: undefined,
        },
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow(
      "At least one of `status` or `assignedTo` must be provided to update the issue",
    );
  });
});
