import { describe, it, expect } from "vitest";
import { TOOL_HANDLERS } from "./tools";

describe("list_organizations", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.list_organizations;
    const result = await tool({
      accessToken: "access-token",
      userId: "1",
      organizationSlug: null,
    });
    expect(result).toMatchInlineSnapshot(`
      "# Organizations

      - sentry-mcp-evals
      "
    `);
  });
});

describe("list_teams", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.list_teams;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Teams in **sentry-mcp-evals**

      - the-goats
      "
    `);
  });
});

describe("list_projects", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.list_projects;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Projects in **sentry-mcp-evals**

      - cloudflare-mcp
      "
    `);
  });
});

describe("list_issues", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.list_issues;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        query: undefined,
        sortBy: "last_seen",
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
});

describe("list_releases", () => {
  it("works without project", async () => {
    const tool = TOOL_HANDLERS.list_releases;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Releases in **sentry-mcp-evals**

      ## 8ce89484-0fec-4913-a2cd-e8e2d41dee36

      **Created**: 2025-04-13T19:54:21.764Z
      **First Event**: 2025-04-13T19:54:21.000Z
      **Last Event**: 2025-04-13T20:28:23.000Z
      **New Issues**: 0
      **Projects**: cloudflare-mcp

      # Using this information

      - You can reference the Release version in commit messages or documentation.
      - You can search for issues in a specific release using the \`search_errors()\` tool with the query \`release:8ce89484-0fec-4913-a2cd-e8e2d41dee36\`.
      "
    `);
  });
  it("works with project", async () => {
    const tool = TOOL_HANDLERS.list_releases;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Releases in **sentry-mcp-evals/cloudflare-mcp**

      ## 8ce89484-0fec-4913-a2cd-e8e2d41dee36

      **Created**: 2025-04-13T19:54:21.764Z
      **First Event**: 2025-04-13T19:54:21.000Z
      **Last Event**: 2025-04-13T20:28:23.000Z
      **New Issues**: 0
      **Projects**: cloudflare-mcp

      # Using this information

      - You can reference the Release version in commit messages or documentation.
      - You can search for issues in a specific release using the \`search_errors()\` tool with the query \`release:8ce89484-0fec-4913-a2cd-e8e2d41dee36\`.
      "
    `);
  });
});

describe("list_tags", () => {
  it("works", async () => {
    const tool = TOOL_HANDLERS.list_tags;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Tags in **sentry-mcp-evals**

      - transaction
      - runtime.name
      - level
      - device
      - os
      - user
      - runtime
      - release
      - url
      - uptime_rule
      - server_name
      - browser
      - os.name
      - device.family
      - replayId
      - client_os.name
      - environment
      - service
      - browser.name

      # Using this information

      - You can reference tags in the \`query\` parameter of various tools: \`tagName:tagValue\`.
      "
    `);
  });
});

describe("search_errors", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.search_errors;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: undefined,
        filename: undefined,
        transaction: undefined,
        query: undefined,
        sortBy: "count",
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

describe("search_transactions", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.search_transactions;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: undefined,
        transaction: undefined,
        query: undefined,
        sortBy: "duration",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Transactions in **sentry-mcp-evals**


      ## GET /trpc/bottleList

      **Span ID**: 07752c6aeb027c8f
      **Trace ID**: 6a477f5b0f31ef7b6b9b5e1dea66c91d
      **Span Operation**: http.server
      **Span Description**: GET /trpc/bottleList
      **Duration**: 12
      **Timestamp**: 2025-04-13T14:19:18+00:00
      **Project**: peated
      **URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d

      ## GET /trpc/bottleList

      **Span ID**: 7ab5edf5b3ba42c9
      **Trace ID**: 54177131c7b192a446124daba3136045
      **Span Operation**: http.server
      **Span Description**: GET /trpc/bottleList
      **Duration**: 18
      **Timestamp**: 2025-04-13T14:19:17+00:00
      **Project**: peated
      **URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/54177131c7b192a446124daba3136045

      "
    `);
  });
});

describe("get_issue_summary", () => {
  it("serializes with issueId", async () => {
    const tool = TOOL_HANDLERS.get_issue_summary;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        issueUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# CLOUDFLARE-MCP-41

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **Occurrences**: 25
      **Users Impacted**: 1
      **Status**: unresolved
      **Platform**: javascript
      **Project**: CLOUDFLARE-MCP
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41
      "
    `);
  });

  it("serializes with issueUrl", async () => {
    const tool = TOOL_HANDLERS.get_issue_summary;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: undefined,
        issueId: undefined,
        issueUrl: "https://sentry-mcp-evals.sentry.io/issues/6507376925",
      },
    );

    expect(result).toMatchInlineSnapshot(`
      "# CLOUDFLARE-MCP-41

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **Occurrences**: 25
      **Users Impacted**: 1
      **Status**: unresolved
      **Platform**: javascript
      **Project**: CLOUDFLARE-MCP
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41
      "
    `);
  });
});

describe("get_issue_details", () => {
  it("serializes with issueId", async () => {
    const tool = TOOL_HANDLERS.get_issue_details;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        issueUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# CLOUDFLARE-MCP-41

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Event Specifics

      **Occurred At**: 2025-04-08T21:15:04.000Z
      **Error:**
      \`\`\`
      Error: Tool list_organizations is already registered
      \`\`\`

      **Stacktrace:**
      \`\`\`
      index.js:7809:27
      index.js:8029:24 (OAuthProviderImpl.fetch)
      index.js:19631:28 (Object.fetch)
      \`\`\`

      # Using this information

      - You can reference the IssueID in commit messages (e.g. \`Fixes CLOUDFLARE-MCP-41\`) to automatically close the issue when the commit is merged.
      - The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.
      "
    `);
  });

  it("serializes with issueUrl", async () => {
    const tool = TOOL_HANDLERS.get_issue_details;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: undefined,
        issueId: undefined,
        issueUrl: "https://sentry-mcp-evals.sentry.io/issues/6507376925",
      },
    );

    expect(result).toMatchInlineSnapshot(`
      "# CLOUDFLARE-MCP-41

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Event Specifics

      **Occurred At**: 2025-04-08T21:15:04.000Z
      **Error:**
      \`\`\`
      Error: Tool list_organizations is already registered
      \`\`\`

      **Stacktrace:**
      \`\`\`
      index.js:7809:27
      index.js:8029:24 (OAuthProviderImpl.fetch)
      index.js:19631:28 (Object.fetch)
      \`\`\`

      # Using this information

      - You can reference the IssueID in commit messages (e.g. \`Fixes 6507376925\`) to automatically close the issue when the commit is merged.
      - The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.
      "
    `);
  });
});

describe("create_team", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.create_team;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        name: "the-goats",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# New Team

      **ID**: 4509109078196224
      **Slug**: the-goats
      **Name**: the-goats
      # Using this information

      - You should always inform the user of the Team Slug value.
      "
    `);
  });
});

describe("create_project", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.create_project;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: "the-goats",
        name: "cloudflare-mcp",
        platform: "javascript",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# New Project

      **ID**: 4509109104082945
      **Slug**: cloudflare-mcp
      **Name**: cloudflare-mcp
      **SENTRY_DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945

      # Using this information

      - You can reference the **SENTRY_DSN** value to initialize Sentry's SDKs.
      - You should always inform the user of the **SENTRY_DSN** and Project Slug values.
      "
    `);
  });
});
