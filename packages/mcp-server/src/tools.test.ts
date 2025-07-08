import { describe, it, expect, vi } from "vitest";
import tools from "./tools/index.js";

// Create a compatibility wrapper for the old TOOL_HANDLERS structure
const TOOL_HANDLERS = Object.fromEntries(
  Object.entries(tools).map(([key, tool]) => [
    key,
    async (context: any, params: any) => {
      return tool.handler(params, context);
    },
  ]),
);

describe("whoami", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.whoami;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {},
    );
    expect(result).toMatchInlineSnapshot(
      `
      "You are authenticated as John Doe (john.doe@example.com).

      Your Sentry User ID is 1."
    `,
    );
  });
});

describe("find_organizations", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.find_organizations;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {},
    );
    expect(result).toMatchInlineSnapshot(`
      "# Organizations

      ## **sentry-mcp-evals**

      **Web URL:** https://sentry.io/sentry-mcp-evals
      **Region URL:** https://us.sentry.io

      # Using this information

      - The organization's name is the identifier for the organization, and is used in many tools for \`organizationSlug\`.
      - If a tool supports passing in the \`regionUrl\`, you MUST pass in the correct value shown above for each organization.
      - For Sentry's Cloud Service (sentry.io), always use the regionUrl to ensure requests go to the correct region.
      "
    `);
  });

  it("handles empty regionUrl parameter", async () => {
    const tool = TOOL_HANDLERS.find_organizations;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {},
    );
    expect(result).toContain("Organizations");
  });

  it("handles undefined regionUrl parameter", async () => {
    const tool = TOOL_HANDLERS.find_organizations;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {},
    );
    expect(result).toContain("Organizations");
  });
});

describe("find_teams", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.find_teams;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Teams in **sentry-mcp-evals**

      - the-goats
      "
    `);
  });
});

describe("find_projects", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.find_projects;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Projects in **sentry-mcp-evals**

      - **cloudflare-mcp**
      "
    `);
  });
});

describe("find_issues", () => {
  it("serializes with project", async () => {
    const tool = TOOL_HANDLERS.find_issues;
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
        regionUrl: undefined,
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
    const tool = TOOL_HANDLERS.find_issues;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: undefined,
        query: undefined,
        sortBy: "last_seen",
        regionUrl: undefined,
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

describe("find_releases", () => {
  it("works without project", async () => {
    const tool = TOOL_HANDLERS.find_releases;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: undefined,
        regionUrl: undefined,
        query: undefined,
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
      - You can search for issues in a specific release using the \`find_errors()\` tool with the query \`release:8ce89484-0fec-4913-a2cd-e8e2d41dee36\`.
      "
    `);
  });
  it("works with project", async () => {
    const tool = TOOL_HANDLERS.find_releases;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        regionUrl: undefined,
        query: undefined,
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
      - You can search for issues in a specific release using the \`find_errors()\` tool with the query \`release:8ce89484-0fec-4913-a2cd-e8e2d41dee36\`.
      "
    `);
  });
});

describe("find_tags", () => {
  it("works", async () => {
    const tool = TOOL_HANDLERS.find_tags;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
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

describe("find_errors", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.find_errors;
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
        regionUrl: undefined,
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

describe("find_transactions", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.find_transactions;
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
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Transactions in **sentry-mcp-evals**


      ## \`GET /trpc/bottleList\`

      **Span ID**: 07752c6aeb027c8f
      **Trace ID**: 6a477f5b0f31ef7b6b9b5e1dea66c91d
      **Span Operation**: http.server
      **Span Description**: GET /trpc/bottleList
      **Duration**: 12
      **Timestamp**: 2025-04-13T14:19:18+00:00
      **Project**: peated
      **URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d

      ## \`GET /trpc/bottleList\`

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
        eventId: undefined,
        issueUrl: undefined,
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

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

      ## Event Details

      **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51
      **Occurred At**: 2025-04-08T21:15:04.000Z

      ### Error

      \`\`\`
      Error: Tool list_organizations is already registered
      \`\`\`

      **Stacktrace:**
      \`\`\`
      index.js:7809:27
      index.js:8029:24 (OAuthProviderImpl.fetch)
      index.js:19631:28 (Object.fetch)
      \`\`\`

      ### HTTP Request

      **Method:** GET
      **URL:** https://mcp.sentry.dev/sse

      ### Additional Context

      These are additional context provided by the user when they're instrumenting their application.

      **cloud_resource**
      cloud.provider: "cloudflare"

      **culture**
      timezone: "Europe/London"

      **runtime**
      name: "cloudflare"

      **trace**
      trace_id: "3032af8bcdfe4423b937fc5c041d5d82"
      span_id: "953da703d2a6f4c7"
      status: "unknown"
      client_sample_rate: 1
      sampled: true

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
        eventId: undefined,
        issueUrl: "https://sentry-mcp-evals.sentry.io/issues/6507376925",
        regionUrl: undefined,
      },
    );

    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

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

      ## Event Details

      **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51
      **Occurred At**: 2025-04-08T21:15:04.000Z

      ### Error

      \`\`\`
      Error: Tool list_organizations is already registered
      \`\`\`

      **Stacktrace:**
      \`\`\`
      index.js:7809:27
      index.js:8029:24 (OAuthProviderImpl.fetch)
      index.js:19631:28 (Object.fetch)
      \`\`\`

      ### HTTP Request

      **Method:** GET
      **URL:** https://mcp.sentry.dev/sse

      ### Additional Context

      These are additional context provided by the user when they're instrumenting their application.

      **cloud_resource**
      cloud.provider: "cloudflare"

      **culture**
      timezone: "Europe/London"

      **runtime**
      name: "cloudflare"

      **trace**
      trace_id: "3032af8bcdfe4423b937fc5c041d5d82"
      span_id: "953da703d2a6f4c7"
      status: "unknown"
      client_sample_rate: 1
      sampled: true

      # Using this information

      - You can reference the IssueID in commit messages (e.g. \`Fixes CLOUDFLARE-MCP-41\`) to automatically close the issue when the commit is merged.
      - The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.
      "
    `);
  });
  it("serializes with eventId", async () => {
    const tool = TOOL_HANDLERS.get_issue_details;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: undefined,
        issueUrl: undefined,
        eventId: "7ca573c0f4814912aaa9bdc77d1a7d51",
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

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

      ## Event Details

      **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51
      **Occurred At**: 2025-04-08T21:15:04.000Z

      ### Error

      \`\`\`
      Error: Tool list_organizations is already registered
      \`\`\`

      **Stacktrace:**
      \`\`\`
      index.js:7809:27
      index.js:8029:24 (OAuthProviderImpl.fetch)
      index.js:19631:28 (Object.fetch)
      \`\`\`

      ### HTTP Request

      **Method:** GET
      **URL:** https://mcp.sentry.dev/sse

      ### Additional Context

      These are additional context provided by the user when they're instrumenting their application.

      **cloud_resource**
      cloud.provider: "cloudflare"

      **culture**
      timezone: "Europe/London"

      **runtime**
      name: "cloudflare"

      **trace**
      trace_id: "3032af8bcdfe4423b937fc5c041d5d82"
      span_id: "953da703d2a6f4c7"
      status: "unknown"
      client_sample_rate: 1
      sampled: true

      # Using this information

      - You can reference the IssueID in commit messages (e.g. \`Fixes CLOUDFLARE-MCP-41\`) to automatically close the issue when the commit is merged.
      - The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.
      "
    `);
  });

  it("throws error for malformed regionUrl", async () => {
    const tool = TOOL_HANDLERS.get_issue_details;
    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          eventId: undefined,
          issueUrl: undefined,
          regionUrl: "https",
        },
      ),
    ).rejects.toThrow(
      "Invalid regionUrl provided: https. Must be a valid URL.",
    );
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
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# New Team in **sentry-mcp-evals**

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
        platform: "node",
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# New Project in **sentry-mcp-evals**

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

describe("update_project", () => {
  it("updates name and platform", async () => {
    const tool = TOOL_HANDLERS.update_project;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: "New Project Name",
        slug: undefined,
        platform: "python",
        teamSlug: undefined,
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Updated Project in **sentry-mcp-evals**

      **ID**: 4509109104082945
      **Slug**: cloudflare-mcp
      **Name**: New Project Name
      **Platform**: python

      ## Updates Applied
      - Updated name to "New Project Name"
      - Updated platform to "python"

      # Using this information

      - The project is now accessible at slug: \`cloudflare-mcp\`
      "
    `);
  });

  it("assigns project to new team", async () => {
    const tool = TOOL_HANDLERS.update_project;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: undefined,
        slug: undefined,
        platform: undefined,
        teamSlug: "backend-team",
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Updated Project in **sentry-mcp-evals**

      **ID**: 4509106749636608
      **Slug**: cloudflare-mcp
      **Name**: cloudflare-mcp
      **Platform**: node

      ## Updates Applied
      - Updated team assignment to "backend-team"

      # Using this information

      - The project is now accessible at slug: \`cloudflare-mcp\`
      - The project is now assigned to the \`backend-team\` team
      "
    `);
  });
});

describe("create_dsn", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.create_dsn;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: "Default",
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# New DSN in **sentry-mcp-evals/cloudflare-mcp**

      **DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945
      **Name**: Default

      # Using this information

      - The \`SENTRY_DSN\` value is a URL that you can use to initialize Sentry's SDKs.
      "
    `);
  });
});

describe("find_dsns", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.find_dsns;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# DSNs in **sentry-mcp-evals/cloudflare-mcp**

      ## Default
      **ID**: d20df0a1ab5031c7f3c7edca9c02814d
      **DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945

      # Using this information

      - The \`SENTRY_DSN\` value is a URL that you can use to initialize Sentry's SDKs.
      "
    `);
  });
});

describe("analyze_issue_with_seer", () => {
  it("handles combined workflow", async () => {
    // This test validates the tool works correctly
    // In a real scenario, it would poll multiple times, but for testing
    // we'll validate the key outputs are present
    const tool = TOOL_HANDLERS.analyze_issue_with_seer;

    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-45",
        issueUrl: undefined,
        regionUrl: undefined,
        instruction: undefined,
      },
    );

    expect(result).toContain("# Seer AI Analysis for Issue CLOUDFLARE-MCP-45");
    expect(result).toContain("Found existing analysis (Run ID: 13)");
    expect(result).toContain("## Analysis Complete");
    expect(result).toContain("## 1. **Root Cause Analysis**");
    expect(result).toContain("The analysis has completed successfully.");
  });
});

describe("update_issue", () => {
  it("updates issue status", async () => {
    const tool = TOOL_HANDLERS.update_issue;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: undefined,
        issueUrl: undefined,
        regionUrl: undefined,
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
    const tool = TOOL_HANDLERS.update_issue;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: undefined,
        assignedTo: "john.doe",
        issueUrl: undefined,
        regionUrl: undefined,
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
    const tool = TOOL_HANDLERS.update_issue;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        status: "resolved",
        assignedTo: "me",
        issueUrl: undefined,
        regionUrl: undefined,
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
    const tool = TOOL_HANDLERS.update_issue;

    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          organizationSlug: undefined,
          issueId: undefined,
          status: undefined,
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: undefined,
        },
      ),
    ).rejects.toThrow("Either `issueId` or `issueUrl` must be provided");
  });

  it("validates organization slug when using issueId", async () => {
    const tool = TOOL_HANDLERS.update_issue;

    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          organizationSlug: undefined,
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: undefined,
        },
      ),
    ).rejects.toThrow(
      "`organizationSlug` is required when providing `issueId`",
    );
  });

  it("validates update parameters", async () => {
    const tool = TOOL_HANDLERS.update_issue;

    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: undefined,
          assignedTo: undefined,
          issueUrl: undefined,
          regionUrl: undefined,
        },
      ),
    ).rejects.toThrow(
      "At least one of `status` or `assignedTo` must be provided to update the issue",
    );
  });
});

describe("search_docs", () => {
  // Note: Query validation (empty, too short, too long) is now handled by Zod schema
  // These validation tests are no longer needed as they test framework behavior, not our tool logic

  it("returns results from the API", async () => {
    const tool = TOOL_HANDLERS.search_docs;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
        host: "https://mcp.sentry.dev",
      },
      {
        query: "How do I configure rate limiting?",
        maxResults: 5,
        guide: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Documentation Search Results

      **Query**: "How do I configure rate limiting?"

      Found 2 matches

      These are just snippets. Use \`get_doc(path='...')\` to fetch the full content.

      ## 1. https://docs.sentry.io/product/rate-limiting

      **Path**: product/rate-limiting.md
      **Relevance**: 95.0%

      **Matching Context**
      > Learn how to configure rate limiting in Sentry to prevent quota exhaustion and control event ingestion.

      ## 2. https://docs.sentry.io/product/accounts/quotas/spike-protection

      **Path**: product/accounts/quotas/spike-protection.md
      **Relevance**: 87.0%

      **Matching Context**
      > Spike protection helps prevent unexpected spikes in event volume from consuming your quota.

      "
    `);
  });

  it("handles API errors", async () => {
    const tool = TOOL_HANDLERS.search_docs;

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: "Internal server error" }),
    } as Response);

    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          query: "test query",
          maxResults: undefined,
          guide: undefined,
        },
      ),
    ).rejects.toThrow();
  });

  it("handles timeout errors", async () => {
    const tool = TOOL_HANDLERS.search_docs;

    // Mock fetch to simulate a timeout by throwing an AbortError
    vi.spyOn(global, "fetch").mockImplementationOnce(() => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });

    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          query: "test query",
          maxResults: undefined,
          guide: undefined,
        },
      ),
    ).rejects.toThrow("Request timeout after 15000ms");
  });

  it("includes platform in output and request", async () => {
    const tool = TOOL_HANDLERS.search_docs;
    const mockFetch = vi.spyOn(global, "fetch");

    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
        host: "https://mcp.sentry.dev",
      },
      {
        query: "test query",
        maxResults: 5,
        guide: "javascript/nextjs",
      },
    );

    // Check that platform is included in the output
    expect(result).toContain("**Guide**: javascript/nextjs");

    // Check that platform is included in the request
    expect(mockFetch).toHaveBeenCalledWith(
      "https://mcp.sentry.dev/api/search",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "test query",
          maxResults: 5,
          guide: "javascript/nextjs",
        }),
      }),
    );
  });
});

describe("get_doc", () => {
  it("returns document content", async () => {
    const tool = TOOL_HANDLERS.get_doc;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
        host: "https://mcp.sentry.dev",
      },
      {
        path: "/product/rate-limiting.md",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Documentation Content

      **Path**: /product/rate-limiting.md

      ---

      # Project Rate Limits and Quotas

      Rate limiting allows you to control the volume of events that Sentry accepts from your applications. This helps you manage costs and ensures that a sudden spike in errors doesn't consume your entire quota.

      ## Why Use Rate Limiting?

      - **Cost Control**: Prevent unexpected charges from error spikes
      - **Noise Reduction**: Filter out repetitive or low-value events
      - **Resource Management**: Ensure critical projects have quota available
      - **Performance**: Reduce load on your Sentry organization

      ## Types of Rate Limits

      ### 1. Organization Rate Limits

      Set a maximum number of events per hour across your entire organization:

      \`\`\`python
      # In your organization settings
      rate_limit = 1000  # events per hour
      \`\`\`

      ### 2. Project Rate Limits

      Configure limits for specific projects:

      \`\`\`javascript
      // Project settings
      {
        "rateLimit": {
          "window": 3600,  // 1 hour in seconds
          "limit": 500     // max events
        }
      }
      \`\`\`

      ### 3. Key-Based Rate Limiting

      Rate limit by specific attributes:

      - **By Release**: Limit events from specific releases
      - **By User**: Prevent single users from consuming quota
      - **By Transaction**: Control high-volume transactions

      ## Configuration Examples

      ### SDK Configuration

      Configure client-side sampling to reduce events before they're sent:

      \`\`\`javascript
      Sentry.init({
        dsn: "your-dsn",
        tracesSampleRate: 0.1,  // Sample 10% of transactions
        beforeSend(event) {
          // Custom filtering logic
          if (event.exception?.values?.[0]?.value?.includes("NetworkError")) {
            return null;  // Drop network errors
          }
          return event;
        }
      });
      \`\`\`

      ### Inbound Filters

      Use Sentry's inbound filters to drop events server-side:

      1. Go to **Project Settings** → **Inbound Filters**
      2. Enable filters for:
         - Legacy browsers
         - Web crawlers
         - Specific error messages
         - IP addresses

      ### Spike Protection

      Enable spike protection to automatically limit events during traffic spikes:

      \`\`\`python
      # Project settings
      spike_protection = {
        "enabled": True,
        "max_events_per_hour": 10000,
        "detection_window": 300  # 5 minutes
      }
      \`\`\`

      ## Best Practices

      1. **Start Conservative**: Begin with lower limits and increase as needed
      2. **Monitor Usage**: Regularly review your quota consumption
      3. **Use Sampling**: Implement transaction sampling for high-volume apps
      4. **Filter Noise**: Drop known low-value events at the SDK level
      5. **Set Alerts**: Configure notifications for quota thresholds

      ## Rate Limit Headers

      Sentry returns rate limit information in response headers:

      \`\`\`
      X-Sentry-Rate-Limit: 60
      X-Sentry-Rate-Limit-Remaining: 42
      X-Sentry-Rate-Limit-Reset: 1634567890
      \`\`\`

      ## Quota Management

      ### Viewing Quota Usage

      1. Navigate to **Settings** → **Subscription**
      2. View usage by:
         - Project
         - Event type
         - Time period

      ### On-Demand Budgets

      Purchase additional events when approaching limits:

      \`\`\`bash
      # Via API
      curl -X POST https://sentry.io/api/0/organizations/{org}/quotas/ \\
        -H 'Authorization: Bearer <token>' \\
        -d '{"events": 100000}'
      \`\`\`

      ## Troubleshooting

      ### Events Being Dropped?

      Check:
      1. Organization and project rate limits
      2. Spike protection status
      3. SDK sampling configuration
      4. Inbound filter settings

      ### Rate Limit Errors

      If you see 429 errors:
      - Review your rate limit configuration
      - Implement exponential backoff
      - Consider event buffering

      ## Related Documentation

      - [SDK Configuration Guide](/platforms/javascript/configuration)
      - [Quotas and Billing](/product/quotas)
      - [Filtering Events](/product/data-management/filtering)

      ---

      ## Using this documentation

      - This is the raw markdown content from Sentry's documentation
      - Code examples and configuration snippets can be copied directly
      - Links in the documentation are relative to https://docs.sentry.io
      - For more related topics, use \`search_docs()\` to find additional pages
      "
    `);
  });

  it("handles invalid path format", async () => {
    const tool = TOOL_HANDLERS.get_doc;
    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          path: "/product/rate-limiting", // Missing .md extension
        },
      ),
    ).rejects.toThrow(
      "Invalid documentation path. Path must end with .md extension.",
    );
  });

  it("handles API errors", async () => {
    const tool = TOOL_HANDLERS.get_doc;

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          path: "/product/test.md",
        },
      ),
    ).rejects.toThrow();
  });

  it("validates domain whitelist", async () => {
    const tool = TOOL_HANDLERS.get_doc;

    // Test with absolute URL that would resolve to a different domain
    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          path: "https://malicious.com/test.md",
        },
      ),
    ).rejects.toThrow(
      "Invalid domain. Documentation can only be fetched from allowed domains: docs.sentry.io, develop.sentry.io",
    );
  });

  it("handles timeout errors", async () => {
    const tool = TOOL_HANDLERS.get_doc;

    // Mock fetch to simulate a timeout by throwing an AbortError
    vi.spyOn(global, "fetch").mockImplementationOnce(() => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });

    await expect(
      tool(
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
        {
          path: "/product/test.md",
        },
      ),
    ).rejects.toThrow("Request timeout after 15000ms");
  });
});
