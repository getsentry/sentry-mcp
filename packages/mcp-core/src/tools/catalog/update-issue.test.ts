import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { issueFixture, mswServer } from "@sentry/mcp-server-mocks";
import updateIssue from "./update-issue.js";
import type { ToolHandlerResult, ToolResult } from "../types";

type MockIssue = typeof issueFixture;

const serverContext = {
  constraints: {
    organizationSlug: undefined,
  },
  accessToken: "access-token",
  userId: "1",
};

function createIssue(overrides: Partial<MockIssue> = {}): MockIssue {
  return {
    ...structuredClone(issueFixture),
    ...overrides,
  };
}

function getTextToolResult(result: ToolHandlerResult): string {
  expect(typeof result).toBe("object");
  expect(result).not.toBeNull();
  expect(Array.isArray(result)).toBe(false);

  const toolResult = result as ToolResult;
  expect(toolResult.isError).not.toBe(true);
  expect(toolResult.content).toHaveLength(1);

  const content = toolResult.content[0];
  expect(content.type).toBe("text");
  if (content.type !== "text") {
    throw new Error(`Expected text content, got ${content.type}`);
  }

  return content.text;
}

afterEach(() => {
  mswServer.resetHandlers();
});

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
      serverContext,
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

      ## Response Notes

      - The issue has been updated in Sentry.
      - Full issue details: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
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
      serverContext,
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

      ## Response Notes

      - The issue has been updated in Sentry.
      - Full issue details: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
      "
    `);
  });

  it("skips status updates when the requested status is already set", async () => {
    let putCalled = false;
    const currentIssue = createIssue({
      status: "resolved",
      statusDetails: {},
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          putCalled = true;
          return HttpResponse.json(currentIssue);
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(putCalled).toBe(false);
    expect(result).toContain("No changes were needed.");
    expect(result).toContain("**Status**: resolved");
  });

  it("skips assignment updates when the requested assignee is already set", async () => {
    let putCalled = false;
    const currentIssue = createIssue();

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          putCalled = true;
          return HttpResponse.json(currentIssue);
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: undefined,
        assignedTo: "user:12345",
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(putCalled).toBe(false);
    expect(result).toContain("No changes were needed.");
    expect(result).not.toContain("→");
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
      serverContext,
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

      ## Response Notes

      - The issue has been updated in Sentry.
      - Full issue details: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
      - The issue is now marked as resolved and will no longer generate alerts
      "
    `);
  });

  it("updates issue as resolved in next release", async () => {
    const currentIssue = createIssue({
      status: "unresolved",
      statusDetails: {},
    });
    const updatedIssue = createIssue({
      status: "resolved",
      statusDetails: {
        inNextRelease: true,
      },
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(updatedIssue),
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolvedInNextRelease",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(result).toContain(
      "**Status**: unresolved → **resolvedInNextRelease**",
    );
    expect(result).toContain("**Status**: resolvedInNextRelease");
    expect(result).toContain(
      "The issue is now marked as resolved in the upcoming release",
    );
  });

  it("skips updates when the issue is already resolved in next release", async () => {
    let putCalled = false;
    const currentIssue = createIssue({
      status: "resolved",
      statusDetails: {
        inNextRelease: true,
      },
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          putCalled = true;
          return HttpResponse.json(currentIssue);
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolvedInNextRelease",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(putCalled).toBe(false);
    expect(result).toContain("No changes were needed.");
    expect(result).toContain("**Status**: resolvedInNextRelease");
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
      serverContext,
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
      serverContext,
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

      ## Response Notes

      - The issue has been updated in Sentry.
      - Full issue details: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
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
      serverContext,
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
      serverContext,
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

      ## Response Notes

      - The issue has been updated in Sentry.
      - Full issue details: \`get_sentry_resource(resourceType="issue", organizationSlug="sentry-mcp-evals", resourceId="CLOUDFLARE-MCP-41")\`
      - The issue is now ignored until it occurs 100 times in 60 minutes
      "
    `);
  });

  it("preserves existing ignore behavior when assigning an already ignored issue", async () => {
    let lastRequestBody: Record<string, unknown> | undefined;
    let currentIssue = createIssue({
      status: "ignored",
      substatus: "archived_until_condition_met",
      statusDetails: {
        ignoreCount: 3,
        ignoreWindow: 60,
      },
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        async ({ request }) => {
          lastRequestBody = (await request.json()) as Record<string, unknown>;
          currentIssue = {
            ...currentIssue,
            assignedTo: lastRequestBody.assignedTo ?? currentIssue.assignedTo,
          };
          return HttpResponse.json(currentIssue);
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "ignored",
        assignedTo: "john.doe",
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(lastRequestBody).toEqual({
      assignedTo: "john.doe",
    });
    expect(result).toContain(
      "**Ignore Behavior**: Until it occurs 3 times in 60 minutes",
    );
    expect(result).not.toContain("The issue is now ignored");
  });

  it("updates condition-based ignore behavior for already ignored issues", async () => {
    let lastRequestBody: Record<string, unknown> | undefined;
    let currentIssue = createIssue({
      status: "ignored",
      substatus: "archived_until_condition_met",
      statusDetails: {
        ignoreCount: 3,
        ignoreWindow: 60,
      },
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        async ({ request }) => {
          lastRequestBody = (await request.json()) as Record<string, unknown>;
          currentIssue = {
            ...currentIssue,
            status: "ignored",
            statusDetails: {
              ignoreCount: lastRequestBody.ignoreCount,
              ignoreWindow: lastRequestBody.ignoreWindow,
            },
          };
          return HttpResponse.json(currentIssue);
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "ignored",
        ignoreMode: "untilOccurrenceCount",
        ignoreCount: 10,
        ignoreWindowMinutes: 30,
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(lastRequestBody).toEqual({
      status: "ignored",
      substatus: "archived_until_condition_met",
      ignoreCount: 10,
      ignoreWindow: 30,
    });
    expect(result).toContain(
      "**Ignore Behavior**: Until it occurs 3 times in 60 minutes → **Until it occurs 10 times in 30 minutes**",
    );
    expect(result).toContain(
      "**Ignore Behavior**: Until it occurs 10 times in 30 minutes",
    );
  });

  it("returns no changes when the ignore behavior already matches", async () => {
    let putCalled = false;
    const currentIssue = createIssue({
      status: "ignored",
      substatus: "archived_until_condition_met",
      statusDetails: {
        ignoreCount: 3,
      },
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          putCalled = true;
          return HttpResponse.json(currentIssue);
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "ignored",
        ignoreMode: "untilOccurrenceCount",
        ignoreCount: 3,
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(putCalled).toBe(false);
    expect(result).toContain("No changes were needed.");
    expect(result).toContain(
      "**Ignore Behavior**: Until it occurs 3 more times",
    );
  });

  it("rejects cross-family ignore changes for already ignored issues", async () => {
    let putCalled = false;
    const currentIssue = createIssue({
      status: "ignored",
      substatus: "archived_forever",
      statusDetails: {},
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          putCalled = true;
          return HttpResponse.json(currentIssue);
        },
      ),
    );

    await expect(
      updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "ignored",
          ignoreMode: "untilOccurrenceCount",
          ignoreCount: 10,
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        serverContext,
      ),
    ).rejects.toThrow(
      "Changing ignore behavior on an already ignored issue between `untilEscalating`, `forever`, and condition-based modes is not supported.",
    );
    expect(putCalled).toBe(false);
  });

  it("returns no changes when the issue is already ignored as requested", async () => {
    let putCalled = false;
    const currentIssue = createIssue({
      status: "ignored",
      substatus: "archived_forever",
      statusDetails: {},
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          putCalled = true;
          return HttpResponse.json(currentIssue);
        },
      ),
    );

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
      serverContext,
    );

    expect(putCalled).toBe(false);
    expect(result).toContain("No changes were needed.");
    expect(result).toContain("**Ignore Behavior**: Forever");
  });

  it("treats archived_forever as authoritative over stale ignore details", async () => {
    let putCalled = false;
    const currentIssue = createIssue({
      status: "ignored",
      substatus: "archived_forever",
      statusDetails: {
        ignoreCount: 3,
      },
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          putCalled = true;
          return HttpResponse.json(currentIssue);
        },
      ),
    );

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
      serverContext,
    );

    expect(putCalled).toBe(false);
    expect(result).toContain("No changes were needed.");
    expect(result).toContain("**Ignore Behavior**: Forever");
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
        serverContext,
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
        serverContext,
      ),
    ).rejects.toThrow(
      "`organizationSlug` is required when providing `issueId`",
    );
  });

  it("rejects issues outside the active project constraint", async () => {
    await expect(
      updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        {
          ...serverContext,
          constraints: {
            ...serverContext.constraints,
            projectSlug: "frontend",
          },
        },
      ),
    ).rejects.toThrow(
      'Issue is outside the active project constraint. Expected project "frontend".',
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
        serverContext,
      ),
    ).rejects.toThrow(
      "At least one of `status`, `assignedTo`, `externalIssueUrl`, or `reason` must be provided to update the issue",
    );
  });

  it("links a native external issue without updating status or assignment", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        externalIssueUrl: "https://github.com/getsentry/sentry/issues/123",
        status: undefined,
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(result).toContain(
      "**Linked External Issue**: getsentry/sentry#123 (github) → https://github.com/getsentry/sentry/issues/123",
    );
    expect(result).toContain("- The external issue has been linked in Sentry.");
  });

  it("updates status and links a native external issue", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        externalIssueUrl: "https://github.com/getsentry/sentry/issues/123",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(result).toContain("**Status**: unresolved → **resolved**");
    expect(result).toContain(
      "**Linked External Issue**: getsentry/sentry#123 (github) → https://github.com/getsentry/sentry/issues/123",
    );
  });

  it("links a Linear issue through Sentry Apps", async () => {
    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        externalIssueUrl: "https://linear.app/acme/issue/ENG-123/test",
        status: undefined,
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(result).toContain(
      "**Linked External Issue**: ENG-123 (linear) → https://linear.app/acme/issue/ENG-123/test",
    );
  });

  it.each([
    {
      provider: "jira",
      url: "https://acme.atlassian.net/browse/ENG-123",
      integration: {
        id: "jira-1",
        name: "Jira",
        domainName: "acme.atlassian.net",
        provider: { key: "jira", slug: "jira", name: "Jira" },
      },
      config: [
        { name: "externalIssue", required: true },
        { name: "comment", required: false, default: "Sentry Issue" },
      ],
      response: {
        id: "external-issue-jira",
        key: "ENG-123",
        url: "https://acme.atlassian.net/browse/ENG-123",
        integrationId: "jira-1",
        displayName: "ENG-123",
      },
      expected: "ENG-123 (jira)",
    },
    {
      provider: "gitlab",
      url: "https://gitlab.com/getsentry/backend/-/issues/456",
      integration: {
        id: "gitlab-1",
        name: "GitLab",
        domainName: "gitlab.com/getsentry",
        provider: { key: "gitlab", slug: "gitlab", name: "GitLab" },
      },
      config: [
        {
          name: "project",
          required: true,
          choices: [["getsentry/backend", "getsentry/backend"]],
        },
        { name: "externalIssue", required: true },
      ],
      response: {
        id: "external-issue-gitlab",
        key: "getsentry/backend#456",
        url: "https://gitlab.com/getsentry/backend/-/issues/456",
        integrationId: "gitlab-1",
        displayName: "getsentry/backend#456",
      },
      expected: "getsentry/backend#456 (gitlab)",
    },
    {
      provider: "bitbucket",
      url: "https://bitbucket.org/getsentry/sentry/issues/789/test",
      integration: {
        id: "bitbucket-1",
        name: "Bitbucket",
        domainName: "bitbucket.org/getsentry",
        provider: { key: "bitbucket", slug: "bitbucket", name: "Bitbucket" },
      },
      config: [
        {
          name: "repo",
          required: true,
          choices: [["getsentry/sentry", "getsentry/sentry"]],
        },
        { name: "externalIssue", required: true },
      ],
      response: {
        id: "external-issue-bitbucket",
        key: "getsentry/sentry#789",
        url: "https://bitbucket.org/getsentry/sentry/issues/789/test",
        integrationId: "bitbucket-1",
        displayName: "getsentry/sentry#789",
      },
      expected: "getsentry/sentry#789 (bitbucket)",
    },
    {
      provider: "vsts",
      url: "https://dev.azure.com/acme/project/_workitems/edit/42",
      integration: {
        id: "vsts-1",
        name: "Azure DevOps",
        domainName: "dev.azure.com/acme",
        provider: { key: "vsts", slug: "vsts", name: "Azure DevOps" },
      },
      config: [{ name: "externalIssue", required: true }],
      response: {
        id: "external-issue-vsts",
        key: "42",
        url: "https://dev.azure.com/acme/project/_workitems/edit/42",
        integrationId: "vsts-1",
        displayName: "42",
      },
      expected: "42 (vsts)",
    },
  ])(
    "links $provider issue URLs through native integrations",
    async (testCase) => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/integrations/",
          () =>
            HttpResponse.json([
              { ...testCase.integration, externalIssues: [] },
            ]),
        ),
        http.get(
          `https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/integrations/${testCase.integration.id}/`,
          ({ request }) => {
            const url = new URL(request.url);
            if (url.searchParams.get("action") !== "link") {
              return HttpResponse.json(
                { detail: "bad action" },
                { status: 400 },
              );
            }
            return HttpResponse.json({
              ...testCase.integration,
              linkIssueConfig: testCase.config,
            });
          },
        ),
        http.put(
          `https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/integrations/${testCase.integration.id}/`,
          () => HttpResponse.json(testCase.response),
        ),
      );

      const result = await updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          externalIssueUrl: testCase.url,
          status: undefined,
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        serverContext,
      );

      expect(result).toContain(
        `**Linked External Issue**: ${testCase.expected}`,
      );
    },
  );

  it("links a Shortcut issue through Sentry Apps", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/sentry-app-installations/",
        () =>
          HttpResponse.json([
            {
              uuid: "shortcut-installation-uuid",
              status: "installed",
              app: {
                uuid: "shortcut-app-uuid",
                slug: "shortcut",
                sentryAppId: 2,
              },
            },
          ]),
      ),
      http.post(
        "https://sentry.io/api/0/sentry-app-installations/shortcut-installation-uuid/external-issues/",
        async ({ request }) => {
          const body = (await request.json()) as {
            issueId: number;
            webUrl: string;
            identifier: string;
          };
          return HttpResponse.json({
            id: "platform-external-issue-shortcut",
            issueId: String(body.issueId),
            serviceType: "shortcut",
            displayName: body.identifier,
            webUrl: body.webUrl,
          });
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        externalIssueUrl: "https://app.shortcut.com/acme/story/123/test",
        status: undefined,
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(result).toContain(
      "**Linked External Issue**: 123 (shortcut) → https://app.shortcut.com/acme/story/123/test",
    );
  });

  it("does not update the issue when external issue URL validation fails", async () => {
    let updateCalled = false;
    mswServer.use(
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          updateCalled = true;
          return HttpResponse.json(issueFixture);
        },
      ),
    );

    await expect(
      updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
          externalIssueUrl: "https://tickets.example.com/work/ABC-1",
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        serverContext,
      ),
    ).rejects.toThrow("Unsupported external issue URL host");
    expect(updateCalled).toBe(false);
  });

  it("reports ambiguous native integrations before updating", async () => {
    let updateCalled = false;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/integrations/",
        () =>
          HttpResponse.json([
            {
              id: "github-1",
              name: "GitHub A",
              domainName: null,
              provider: { key: "github", slug: "github", name: "GitHub" },
              externalIssues: [],
            },
            {
              id: "github-2",
              name: "GitHub B",
              domainName: null,
              provider: { key: "github", slug: "github", name: "GitHub" },
              externalIssues: [],
            },
          ]),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => {
          updateCalled = true;
          return HttpResponse.json(issueFixture);
        },
      ),
    );

    await expect(
      updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
          externalIssueUrl: "https://github.com/getsentry/sentry/issues/123",
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        serverContext,
      ),
    ).rejects.toThrow("Multiple installed integrations");
    expect(updateCalled).toBe(false);
  });

  it("reports partial success when link write fails after issue update", async () => {
    mswServer.use(
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/integrations/github-integration-1/",
        () =>
          HttpResponse.json(
            { detail: "GitHub rejected the issue link" },
            { status: 400 },
          ),
      ),
    );

    const result = getTextToolResult(
      await updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
          externalIssueUrl: "https://github.com/getsentry/sentry/issues/123",
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        serverContext,
      ),
    );

    expect(result).toContain("Partially Updated");
    expect(result).toContain("The Sentry issue update succeeded.");
    expect(result).toContain("External issue linking failed");
    expect(result).toContain("GitHub rejected the issue link");
  });

  it("posts reason comment in partial success path when link write fails", async () => {
    mswServer.use(
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/integrations/github-integration-1/",
        () =>
          HttpResponse.json(
            { detail: "GitHub rejected the issue link" },
            { status: 400 },
          ),
      ),
    );

    const result = getTextToolResult(
      await updateIssue.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
          externalIssueUrl: "https://github.com/getsentry/sentry/issues/123",
          reason: "Fixing in linked ticket",
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: null,
        },
        serverContext,
      ),
    );

    expect(result).toContain("Partially Updated");
    expect(result).toContain("The Sentry issue update succeeded.");
    expect(result).toContain("External issue linking failed");
    expect(result).toContain("Comment posted");
    expect(result).toContain("Fixing in linked ticket");
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
        serverContext,
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
        serverContext,
      ),
    ).rejects.toThrow("`ignoreWindowMinutes` requires `ignoreCount`");
  });

  it("posts reason as a comment when updating issue status", async () => {
    let commentPosted: { text: string } | undefined;
    const currentIssue = createIssue({
      status: "unresolved",
      statusDetails: {},
    });
    const updatedIssue = createIssue({
      status: "resolved",
      statusDetails: {},
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(updatedIssue),
      ),
      http.post(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/notes/",
        async ({ request }) => {
          commentPosted = (await request.json()) as { text: string };
          return HttpResponse.json({
            id: "12345",
            text: commentPosted.text,
            type: "note",
            dateCreated: new Date().toISOString(),
          });
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
        reason: "Resolved because the root cause was fixed in PR #123",
      },
      serverContext,
    );

    expect(commentPosted).toEqual({
      text: "Resolved because the root cause was fixed in PR #123",
    });
    expect(result).toContain(
      '**Comment posted**: "Resolved because the root cause was fixed in PR #123"',
    );
  });

  it("does not post a comment when reason is not provided", async () => {
    let commentPosted = false;
    const currentIssue = createIssue({
      status: "unresolved",
      statusDetails: {},
    });
    const updatedIssue = createIssue({
      status: "resolved",
      statusDetails: {},
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(updatedIssue),
      ),
      http.post(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/notes/",
        () => {
          commentPosted = true;
          return HttpResponse.json({});
        },
      ),
    );

    await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      serverContext,
    );

    expect(commentPosted).toBe(false);
  });

  it("posts reason as a comment even when no state changes are needed", async () => {
    let commentPosted: { text: string } | undefined;
    const currentIssue = createIssue({
      status: "resolved",
      statusDetails: {},
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.post(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/notes/",
        async ({ request }) => {
          commentPosted = (await request.json()) as { text: string };
          return HttpResponse.json({
            id: "12345",
            text: commentPosted.text,
            type: "note",
            dateCreated: new Date().toISOString(),
          });
        },
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
        reason: "Confirmed this is no longer an issue after deploy",
      },
      serverContext,
    );

    expect(commentPosted).toEqual({
      text: "Confirmed this is no longer an issue after deploy",
    });
    expect(result).toContain("No changes were needed.");
    expect(result).toContain(
      '**Comment posted**: "Confirmed this is no longer an issue after deploy"',
    );
  });

  it("does not throw when comment posting fails after a successful update", async () => {
    const currentIssue = createIssue({
      status: "unresolved",
      statusDetails: {},
    });
    const updatedIssue = createIssue({
      status: "resolved",
      statusDetails: {},
    });

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(currentIssue),
      ),
      http.put(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        () => HttpResponse.json(updatedIssue),
      ),
      http.post(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/notes/",
        () => HttpResponse.json({ detail: "Rate limited" }, { status: 429 }),
      ),
    );

    const result = await updateIssue.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: null,
        reason: "Resolving because fix deployed",
      },
      serverContext,
    );

    // Update succeeded — output should show it
    expect(result).toContain("**Status**: unresolved → **resolved**");
    // Comment failure should be reported gracefully, not thrown
    expect(result).toContain("**Comment not posted**");
  });
});
