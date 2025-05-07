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

      ## **sentry-mcp-evals**

      **Web URL:** https://sentry.io/sentry-mcp-evals
      **Region URL:** https://us.sentry.io

      # Using this information

      - The organization's name is the identifier for the organization, and is used in many tools for \`organizationSlug\`.
      - If a tool supports passing in the \`regionUrl\`, you should also pass in the correct value there.
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

describe("list_issues", () => {
  it("serializes with project", async () => {
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
    const tool = TOOL_HANDLERS.list_issues;
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
        regionUrl: undefined,
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
        regionUrl: undefined,
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
        regionUrl: undefined,
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
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

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
        regionUrl: undefined,
      },
    );

    expect(result).toMatchInlineSnapshot(`
      "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

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
        platform: "javascript",
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

describe("list_dsn", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.list_dsns;
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

describe("begin_autofix", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.begin_autofix;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "PEATED-A8",
        issueUrl: undefined,
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Autofix Started for Issue PEATED-A8

      **Run ID:**: 123

      This operation may take some time, so you should call \`get_autofix_status()\` to check the status of the analysis, and repeat the process until its finished.

      You should also inform the user that the operation may take some time, and give them updates whenever you check the status of the operation..

      \`\`\`
      get_autofix_status(organizationSlug="sentry-mcp-evals", issueId="PEATED-A8")
      \`\`\`"
    `);
  });
});

describe("get_autofix_status", () => {
  it("serializes", async () => {
    const tool = TOOL_HANDLERS.get_autofix_status;
    const result = await tool(
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "PEATED-A8",
        issueUrl: undefined,
        regionUrl: undefined,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Autofix Status for Issue PEATED-A8

      ## Analyzing the Issue

      **The \`bottleById\` query fails because the input ID (3216) doesn't exist in the database.
      **
      The exception details show that the \`input\` value at the time of the \`TRPCError\` in \`bottleById.ts\` was 3216, and the query likely failed because a bottle with ID 3216 was not found in the database.

      \`\`\`
      Variable values at the time of the exception::
      {
        "input": 3216
      }
      \`\`\`


      **However, the request also includes a different ID (16720) for \`bottlePriceList\`.
      **
      The root cause is likely a mismatch of input IDs within the batched TRPC request, where \`bottlePriceList\` expects bottle ID 16720, but \`bottleById\` receives a different ID (3216) leading to the "Bottle not found" error.

      \`\`\`
      GET http://api.peated.com/trpc/bottlePriceList,bottleById
      \`\`\`

      \`\`\`json
      {
        "input": 3216
      }
      \`\`\`

      \`\`\`
      TRPCError: Bottle not found. (occurred in: GET /trpc/bottlePriceList,bottleById)
      \`\`\`


      **This suggests a data consistency issue or incorrect client-side request.
      **
      The \`TRPCError\` originates from \`bottleById.ts\` with the input value being \`3216\`, indicating the procedure failed to find a bottle with that specific ID in the database.

      \`\`\`
       <anonymous> in file /app/apps/server/src/trpc/routes/bottleById.ts [Line 33, column 13] (In app)
            .select({
              ...getTableColumns(bottles),
            })
            .from(bottleTombstones)
            .innerJoin(bottles, eq(bottleTombstones.newBottleId, bottles.id))
            .where(eq(bottleTombstones.bottleId, input));
          if (!bottle) {
            throw new TRPCError({  <-- SUSPECT LINE
              message: "Bottle not found.",
              code: "NOT_FOUND",
            });
          }
        }

        const createdBy = await db.query.users.findFirst({
      ---
      Variable values at the time of the exception::
      {
        "input": 3216
      }
      \`\`\`



      ## Root Cause Analysis

      **The client initiates a batched TRPC request to the \`/trpc/bottlePriceList,bottleById\` endpoint, intending to fetch both the price list and details for a specific bottle.**

      This is the entry point where the client requests data from two different procedures in a single HTTP request. The server needs to correctly route and process the parameters for each procedure.

      **The TRPC server receives the batched request and begins processing the \`bottlePriceList\` procedure, intending to fetch the price list for bottle ID 16720.**

      \`\`\`typescript
      // apps/server/src/trpc/routes/bottlePriceList.ts
      .input(z.object({ bottle: z.number(), onlyValid: z.boolean().optional() }))
      .query(async function ({ input, ctx }) {
        const [bottle] = await db.select().from(bottles).where(eq(bottles.id, input.bottle));
        if (!bottle) { ... }
      \`\`\`
      This procedure expects a 'bottle' parameter in the input, which is used to query the database.

      **The TRPC server also processes the \`bottleById\` procedure, but due to a parameter mapping issue or client-side error, it receives bottle ID 3216 as input instead of 16720.**

      \`\`\`typescript
      // apps/server/src/trpc/routes/bottleById.ts
      export default publicProcedure.input(z.number()).query(async function ({ input, ctx }) {
        let [bottle] = await db.select().from(bottles).where(eq(bottles.id, input));
        if (!bottle) { ... }
      \`\`\`
      This procedure expects a numerical ID as input to find the bottle.

      **The \`bottleById\` procedure queries the \`bottles\` table for a bottle with ID 3216, but no such bottle exists.**

      The database query returns no results because bottle ID 3216 is not present in the \`bottles\` table.

      **The \`bottleById\` procedure then checks the \`bottleTombstones\` table to see if bottle ID 3216 has been tombstoned (redirected to a new ID), but no such tombstone exists.**

      The query to \`bottleTombstones\` also returns no results, indicating that bottle ID 3216 has not been redirected.

      **Since the \`bottleById\` procedure cannot find a bottle with ID 3216 in either the \`bottles\` or \`bottleTombstones\` tables, it throws a \`TRPCError\` with the message "Bottle not found."**

      \`\`\`typescript
      // apps/server/src/trpc/routes/bottleById.ts
      if (!bottle) {
        throw new TRPCError({ message: "Bottle not found.", code: "NOT_FOUND" });
      }
      \`\`\`
      This is where the error is thrown, indicating that the bottle could not be found.


      ## Planning Solution

      **The discrepancy between inputs suggests a potential issue with batch request handling.
      **
      The \`TRPCError\` occurred in \`bottleById.ts\` with an input of \`3216\`, while the request was initiated with a bottle ID of \`16720\`, indicating a mismatch in the bottle ID being processed.

      \`\`\`
      Variable values at the time of the exception::
      {
        "input": 3216
      }
      \`\`\`

      \`\`\`
      GET http://api.peated.com/trpc/bottlePriceList,bottleById
      \`\`\`


      **The client-side batch request construction is the most likely source of error.
      **
      The discrepancy between the bottle ID in the error message (16720) and the ID being processed (3216) strongly suggests a client-side parameter mapping issue in the batched TRPC request.

      To fix this, I propose the following steps:

      1.  **Inspect the Client-Side Code:** Identify the code responsible for constructing the TRPC batch request to \`/trpc/bottlePriceList,bottleById\`.

      2.  **Verify Parameter Mapping:** Ensure that both \`bottlePriceList\` and \`bottleById\` are receiving the correct bottle ID (which should be 16720 in this case).

      3.  **Correct Parameter Assignment:** If the parameters are being incorrectly assigned, modify the client-side code to ensure that both procedures receive the same, correct bottle ID.

      4.  **Add Logging (Client-Side):** Add temporary logging to the client-side code to confirm the parameters being sent to each procedure in the batch request. This will help verify the fix.

          \`\`\`typescript
          // Example logging (add to the client-side code where the batch request is created)
          console.log("bottlePriceList input:", { bottle: 16720 }); // Replace 16720 with the actual ID
          console.log("bottleById input:", { bottle: 16720 }); // Replace 16720 with the actual ID
          \`\`\`

      5.  **Test the Fix:** After applying the fix, test the affected functionality to ensure that the "Bottle not found" error is resolved and that both procedures are working correctly.

      6.  **Remove Logging:** Once the fix is verified, remove the temporary logging.

      This approach directly addresses the most likely cause of the issue and provides a clear path to resolution.


      **Ensuring consistent bottle IDs will likely resolve this inconsistency.
      **
      The error message references bottle ID 16720, but the exception details show the procedure was actually processing ID 3216, indicating a parameter mismatch in the batch request.

      To fix this, I recommend the following steps:

      1.  **Client-Side Investigation**:

          *   Examine the client-side code where the TRPC batch request is constructed.
          *   Verify that the same \`bottleId\` parameter is being passed to both \`bottlePriceList\` and \`bottleById\` procedures.
          *   If the IDs are being passed correctly, inspect the network request payload to confirm the correct structure of the batched request.

          \`\`\`typescript
          // Example (Hypothetical) Client-Side Code
          const bottleId = 16720; // Example bottle ID

          // Ensure both procedures receive the same bottleId
          const [priceList, bottleDetails] = await trpc.batch(() => [
            trpc.bottlePriceList.fetch({ bottle: bottleId }),
            trpc.bottleById.fetch(bottleId),
          ]);
          \`\`\`

      2.  **Server-Side Logging (Temporary)**:

          *   Add temporary logging to both \`bottlePriceList\` and \`bottleById\` procedures to log the received \`input\` value.
          *   This will help confirm whether the server is receiving the correct IDs from the client.
          *   **Important**: Remove these logs after debugging to avoid unnecessary overhead.

          \`\`\`typescript
          // apps/server/src/trpc/routes/bottlePriceList.ts
          export default publicProcedure
            .input(
              z.object({
                bottle: z.number(),
                onlyValid: z.boolean().optional(),
              }),
            )
            .query(async function ({ input, ctx }) {
              console.log("bottlePriceList input:", input); // Add this line
              // ... rest of the code
            });

          // apps/server/src/trpc/routes/bottleById.ts
          export default publicProcedure.input(z.number()).query(async function ({
            input,
            ctx,
          }) {
            console.log("bottleById input:", input); // Add this line
            // ... rest of the code
          });
          \`\`\`

      3.  **TRPC Batch Request Configuration**:

          *   Review the TRPC batch link configuration on the client-side.
          *   Ensure that the batching logic is correctly mapping parameters to the corresponding procedures.
          *   If using a custom batching implementation, verify its correctness.

      4.  **Data Integrity Check**:

          *   If the client-side code appears correct, investigate whether bottle ID 3216 should exist in the database.
          *   Check the \`bottles\` table and \`bottleTombstones\` table for any entries related to bottle ID 3216.
          *   If the bottle should exist but is missing, investigate potential data deletion or migration issues.

      5.  **Tombstone Logic**:

          *   Double-check the logic for creating and using tombstones.
          *   Ensure that when a bottle is deleted, a tombstone entry is created correctly, pointing to the new bottle (if any).

      6.  **Error Handling**:

          *   While this isn't the primary fix, consider improving the error message in \`bottleById.ts\` to include more context.
          *   Include the original requested bottle ID (if available) in the error message to aid debugging.

      7.  **Client-Side Retries**:

          *   Implement a retry mechanism on the client-side for TRPC requests.
          *   If a "Bottle not found" error occurs, retry the request a few times before giving up. This can help mitigate transient issues.

      By following these steps, you should be able to identify the root cause of the parameter mismatch and implement a fix that ensures consistent bottle IDs are passed to both TRPC procedures in the batch request.



      ## Solution

      Consolidate bottle and price data fetching into a single batched TRPC request using \`Promise.all\` to ensure ID consistency.

      **Create a shared utility function to fetch bottle details and price data together.**
      \`\`\`typescript
      // In a shared utility function or component
      export async function getBottleWithPrices(bottleId: number) {
        const trpcClient = await getTrpcClient();
        
        // Use Promise.all to ensure both requests are part of the same batch
        // and receive the same parameters
        const [bottle, priceList] = await Promise.all([
          trpcClient.bottleById.fetch(bottleId),
          trpcClient.bottlePriceList.fetch({ bottle: bottleId }),
        ]);
        
        return { bottle, priceList };
      }
      \`\`\`
      This code creates a function that uses \`Promise.all\` to fetch both bottle details and price data concurrently. This ensures that both TRPC procedures are part of the same batch and receive the same \`bottleId\`.

      **Modify the page components to use the shared utility function.**
      \`\`\`typescript
      // Then in the page components:
      const { bottle, priceList } = await getBottleWithPrices(Number(bottleId));
      \`\`\`
      This code replaces the separate calls to \`bottleById\` and \`bottlePriceList\` with a single call to the \`getBottleWithPrices\` function, ensuring that both components receive data for the same bottle.

      **Add a unit test that reproduces the issue.**
      null


      "
    `);
  });
});
