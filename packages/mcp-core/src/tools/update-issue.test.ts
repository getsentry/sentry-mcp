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
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
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
      **Assigned To**: Jane Developer

      # Using this information

      - The issue has been successfully updated in Sentry
      - You can view the issue details using: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
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
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 Updated in **sentry-mcp-evals**

      **Issue**: Error: Tool list_organizations is already registered
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Changes Made

      **Assigned To**: Jane Developer → **john.doe**

      ## Current Status

      **Status**: unresolved
      **Assigned To**: john.doe

      # Using this information

      - The issue has been successfully updated in Sentry
      - You can view the issue details using: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
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
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 Updated in **sentry-mcp-evals**

      **Issue**: Error: Tool list_organizations is already registered
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Changes Made

      **Status**: unresolved → **resolved**
      **Assigned To**: Jane Developer → **You**

      ## Current Status

      **Status**: resolved
      **Assigned To**: me

      # Using this information

      - The issue has been successfully updated in Sentry
      - You can view the issue details using: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
      - The issue is now marked as resolved and will no longer generate alerts
      "
    `);
  });

  it("assigns issue to team by slug", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: undefined,
        assignedTo: "team:the-goats",
        issueUrl: undefined,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain("Assigned To");
    expect(result).toContain("team:the-goats");
  });

  it("ignores issue until it escalates by default", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "ignored",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 Updated in **sentry-mcp-evals**

      **Issue**: Error: Tool list_organizations is already registered
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Changes Made

      **Status**: unresolved → **ignored**
      **Ignore Behavior**: **Until escalating**

      ## Current Status

      **Status**: ignored
      **Ignore Behavior**: Until escalating
      **Assigned To**: Jane Developer

      # Using this information

      - The issue has been successfully updated in Sentry
      - You can view the issue details using: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
      - The issue is now ignored until it escalates
      "
    `);
  });

  it("ignores issue forever when requested", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "ignored",
        ignoreMode: "forever",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain("**Ignore Behavior**: Forever");
    expect(result).toContain("The issue is now ignored indefinitely");
  });

  it("ignores issue until it occurs a set number of times", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "ignored",
        ignoreMode: "untilOccurrenceCount",
        ignoreCount: 100,
        ignoreWindowMinutes: 60,
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 Updated in **sentry-mcp-evals**

      **Issue**: Error: Tool list_organizations is already registered
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Changes Made

      **Status**: unresolved → **ignored**
      **Ignore Behavior**: **Until it occurs 100 times in 60 minutes**

      ## Current Status

      **Status**: ignored
      **Ignore Behavior**: Until it occurs 100 times in 60 minutes
      **Assigned To**: Jane Developer

      # Using this information

      - The issue has been successfully updated in Sentry
      - You can view the issue details using: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
      - The issue is now ignored until it occurs 100 times in 60 minutes
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
          regionUrl: null,
        },
        {
          constraints: {
            organizationSlug: undefined,
          },
          accessToken: "access-token",
          userId: "1",
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
          regionUrl: null,
        },
        {
          constraints: {
            organizationSlug: undefined,
          },
          accessToken: "access-token",
          userId: "1",
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
          regionUrl: null,
        },
        {
          constraints: {
            organizationSlug: undefined,
          },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow(
      "At least one of `status` or `assignedTo` must be provided to update the issue",
    );
  });

  it("validates ignore options require ignored status", async () => {
    await expect(
      updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
          ignoreMode: "forever",
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        {
          constraints: {
            organizationSlug: undefined,
          },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow(
      "Ignore options can only be used when `status` is `ignored`",
    );
  });

  it("validates ignore windows require a matching count", async () => {
    await expect(
      updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "ignored",
          ignoreWindowMinutes: 60,
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        {
          constraints: {
            organizationSlug: undefined,
          },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow("`ignoreWindowMinutes` requires `ignoreCount`");
  });
});
