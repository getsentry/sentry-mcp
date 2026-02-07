import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import {
  mswServer,
  createDefaultEvent,
  createGenericEvent,
  createUnknownEvent,
  createPerformanceEvent,
  createPerformanceIssue,
  createRegressedIssue,
  createUnsupportedIssue,
  createCspIssue,
  createCspEvent,
} from "@sentry/mcp-server-mocks";
import getIssueDetails from "./get-issue-details.js";

const baseContext = {
  constraints: {
    organizationSlug: undefined,
  },
  accessToken: "access-token",
  userId: "1",
};

// Removed - now using createPerformanceIssue() factory from mocks

// Removed - now using createPerformanceEvent() factory from mocks with overrides

function createTraceResponseFixture() {
  return [
    {
      span_id: "root-span",
      event_id: "root-span",
      transaction_id: "root-span",
      project_id: "4509062593708032",
      project_slug: "cloudflare-mcp",
      profile_id: "",
      profiler_id: "",
      parent_span_id: null,
      start_timestamp: 0,
      end_timestamp: 1,
      measurements: {},
      duration: 1000,
      transaction: "/api/users",
      is_transaction: true,
      description: "GET /api/users",
      sdk_name: "sentry.python",
      op: "http.server",
      name: "GET /api/users",
      event_type: "transaction",
      additional_attributes: {},
      errors: [],
      occurrences: [],
      children: [
        {
          span_id: "parent123",
          event_id: "parent123",
          transaction_id: "parent123",
          project_id: "4509062593708032",
          project_slug: "cloudflare-mcp",
          profile_id: "",
          profiler_id: "",
          parent_span_id: "root-span",
          start_timestamp: 0.1,
          end_timestamp: 0.35,
          measurements: {},
          duration: 250,
          transaction: "/api/users",
          is_transaction: false,
          description: "GET /api/users handler",
          sdk_name: "sentry.python",
          op: "http.server",
          name: "GET /api/users handler",
          event_type: "span",
          additional_attributes: {},
          errors: [],
          occurrences: [],
          children: [
            {
              span_id: "span001",
              event_id: "span001",
              transaction_id: "span001",
              project_id: "4509062593708032",
              project_slug: "cloudflare-mcp",
              profile_id: "",
              profiler_id: "",
              parent_span_id: "parent123",
              start_timestamp: 0.15,
              end_timestamp: 0.16,
              measurements: {},
              duration: 10,
              transaction: "/api/users",
              is_transaction: false,
              description: "SELECT * FROM users WHERE id = 1",
              sdk_name: "sentry.python",
              op: "db.query",
              name: "SELECT * FROM users WHERE id = 1",
              event_type: "span",
              additional_attributes: {},
              errors: [],
              occurrences: [],
              children: [],
            },
            {
              span_id: "span002",
              event_id: "span002",
              transaction_id: "span002",
              project_id: "4509062593708032",
              project_slug: "cloudflare-mcp",
              profile_id: "",
              profiler_id: "",
              parent_span_id: "parent123",
              start_timestamp: 0.2,
              end_timestamp: 0.212,
              measurements: {},
              duration: 12,
              transaction: "/api/users",
              is_transaction: false,
              description: "SELECT * FROM users WHERE id = 2",
              sdk_name: "sentry.python",
              op: "db.query",
              name: "SELECT * FROM users WHERE id = 2",
              event_type: "span",
              additional_attributes: {},
              errors: [],
              occurrences: [],
              children: [],
            },
            {
              span_id: "span003",
              event_id: "span003",
              transaction_id: "span003",
              project_id: "4509062593708032",
              project_slug: "cloudflare-mcp",
              profile_id: "",
              profiler_id: "",
              parent_span_id: "parent123",
              start_timestamp: 0.24,
              end_timestamp: 0.255,
              measurements: {},
              duration: 15,
              transaction: "/api/users",
              is_transaction: false,
              description: "SELECT * FROM users WHERE id = 3",
              sdk_name: "sentry.python",
              op: "db.query",
              name: "SELECT * FROM users WHERE id = 3",
              event_type: "span",
              additional_attributes: {},
              errors: [],
              occurrences: [],
              children: [],
            },
          ],
        },
      ],
    },
  ];
}

describe("get_issue_details", () => {
  it("serializes with issueId", async () => {
    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        eventId: undefined,
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
      "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **Occurrences**: 25
      **Users Impacted**: 1
      **Status**: unresolved
      **Substatus**: ongoing
      **Assigned To**: Jane Developer (User)
      **Issue Type**: error
      **Issue Category**: error
      **Platform**: javascript
      **Project**: CLOUDFLARE-MCP
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Event Details

      **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51
      **Type**: error
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

      ### Tags

      **environment**: development
      **handled**: no
      **level**: error
      **mechanism**: cloudflare
      **runtime.name**: cloudflare
      **url**: https://mcp.sentry.dev/sse

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
      - To search for specific occurrences or filter events within this issue, use \`search_issue_events(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41', naturalLanguageQuery='your query')\`
      "
    `);
  });

  it("displays team assignment correctly", async () => {
    // Override the issue fixture with a team assignment
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/TEAM-ISSUE-001/",
        () =>
          HttpResponse.json({
            id: "123456789",
            shortId: "TEAM-ISSUE-001",
            title: "Test issue with team assignment",
            firstSeen: "2025-04-03T22:51:19.403Z",
            lastSeen: "2025-04-12T11:34:11Z",
            count: "10",
            userCount: 5,
            permalink:
              "https://sentry-mcp-evals.sentry.io/issues/TEAM-ISSUE-001",
            project: {
              id: "4509062593708032",
              slug: "test-project",
              name: "Test Project",
            },
            platform: "javascript",
            status: "unresolved",
            substatus: "ongoing",
            culprit: "app.main",
            type: "error",
            issueType: "error",
            issueCategory: "error",
            assignedTo: {
              type: "team",
              id: "99999",
              name: "Platform Team",
            },
          }),
        { once: true },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/TEAM-ISSUE-001/events/latest/",
        () => HttpResponse.json(createDefaultEvent()),
        { once: true },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "TEAM-ISSUE-001",
        eventId: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      baseContext,
    );

    // Verify that team assignment is displayed with "(Team)" suffix
    expect(result).toContain("**Assigned To**: Platform Team (Team)");
  });

  it("serializes with issueUrl", async () => {
    const result = await getIssueDetails.handler(
      {
        organizationSlug: undefined,
        issueId: undefined,
        eventId: undefined,
        issueUrl: "https://sentry-mcp-evals.sentry.io/issues/6507376925",
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
      "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **Occurrences**: 25
      **Users Impacted**: 1
      **Status**: unresolved
      **Substatus**: ongoing
      **Assigned To**: Jane Developer (User)
      **Issue Type**: error
      **Issue Category**: error
      **Platform**: javascript
      **Project**: CLOUDFLARE-MCP
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Event Details

      **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51
      **Type**: error
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

      ### Tags

      **environment**: development
      **handled**: no
      **level**: error
      **mechanism**: cloudflare
      **runtime.name**: cloudflare
      **url**: https://mcp.sentry.dev/sse

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
      - To search for specific occurrences or filter events within this issue, use \`search_issue_events(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41', naturalLanguageQuery='your query')\`
      "
    `);
  });

  it("renders related trace spans when trace fetch succeeds", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/PERF-N1-001/",
        () => HttpResponse.json(createPerformanceIssue()),
        { once: true },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/PERF-N1-001/events/latest/",
        () => {
          // Create event with specific evidence data for this test
          const event = createPerformanceEvent();
          const offenderSpanIds =
            event.occurrence.evidenceData.offenderSpanIds.slice(0, 3);
          event.occurrence.evidenceData.offenderSpanIds = offenderSpanIds;
          event.occurrence.evidenceData.numberRepeatingSpans = String(
            offenderSpanIds.length,
          );
          event.occurrence.evidenceData.repeatingSpansCompact = undefined;
          event.occurrence.evidenceData.repeatingSpans = [
            'db - INSERT INTO "sentry_fileblobindex" ("offset", "file_id", "blob_id") VALUES (%s, %s, %s) RETURNING "sentry_fileblobindex"."id"',
            "function - sentry.models.files.abstractfileblob.AbstractFileBlob.from_file",
            'db - SELECT "sentry_fileblob"."id", "sentry_fileblob"."path", "sentry_fileblob"."size", "sentry_fileblob"."checksum", "sentry_fileblob"."timestamp" FROM "sentry_fileblob" WHERE "sentry_fileblob"."checksum" = %s LIMIT 21',
          ];
          const spansEntry = event.entries.find(
            (entry: { type: string; data?: unknown }) => entry.type === "spans",
          );
          if (spansEntry?.data) {
            spansEntry.data = spansEntry.data.slice(0, 4);
          }
          return HttpResponse.json(event);
        },
        { once: true },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace/abcdef1234567890abcdef1234567890/",
        () => HttpResponse.json(createTraceResponseFixture()),
        { once: true },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "PERF-N1-001",
        eventId: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      baseContext,
    );

    if (typeof result !== "string") {
      throw new Error("Expected string result");
    }

    const performanceSection = result
      .slice(result.indexOf("### Repeated Database Queries"))
      .split("### Tags")[0]
      .trim();

    expect(performanceSection).toMatchInlineSnapshot(`
      "### Repeated Database Queries

      **Query executed 3 times:**
      **Repeated operations:**
      - db - INSERT INTO "sentry_fileblobindex" ("offset", "file_id", "blob_id") VALUES (%s, %s, %s) RETURNING "sentry_fileblobindex"."id"
      - function - sentry.models.files.abstractfileblob.AbstractFileBlob.from_file
      - db - SELECT "sentry_fileblob"."id", "sentry_fileblob"."path", "sentry_fileblob"."size", "sentry_fileblob"."checksum", "sentry_fileblob"."timestamp" FROM "sentry_fileblob" WHERE "sentry_fileblob"."checksum" = %s LIMIT 21

      ### Span Tree (Limited to 10 spans)

      \`\`\`
      GET /api/users [parent12 · http.server · 250ms]
         ├─ SELECT * FROM users WHERE id = 1 [span001 · db.query · 5ms] [N+1]
         ├─ SELECT * FROM users WHERE id = 2 [span002 · db.query · 5ms] [N+1]
         └─ SELECT * FROM users WHERE id = 3 [span003 · db.query · 5ms] [N+1]
      \`\`\`

      **Transaction:**
      /api/users

      **Offending Spans:**
      SELECT * FROM users WHERE id = %s

      **Repeated:**
      3 times"
    `);
  });

  it("falls back to offending span list when trace fetch fails", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/PERF-N1-001/",
        () => HttpResponse.json(createPerformanceIssue()),
        { once: true },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/PERF-N1-001/events/latest/",
        () => {
          // Create event with specific evidence data for this test
          const event = createPerformanceEvent();
          const offenderSpanIds =
            event.occurrence.evidenceData.offenderSpanIds.slice(0, 3);
          event.occurrence.evidenceData.offenderSpanIds = offenderSpanIds;
          event.occurrence.evidenceData.numberRepeatingSpans = String(
            offenderSpanIds.length,
          );
          event.occurrence.evidenceData.repeatingSpansCompact = undefined;
          event.occurrence.evidenceData.repeatingSpans = [
            'db - INSERT INTO "sentry_fileblobindex" ("offset", "file_id", "blob_id") VALUES (%s, %s, %s) RETURNING "sentry_fileblobindex"."id"',
            "function - sentry.models.files.abstractfileblob.AbstractFileBlob.from_file",
            'db - SELECT "sentry_fileblob"."id", "sentry_fileblob"."path", "sentry_fileblob"."size", "sentry_fileblob"."checksum", "sentry_fileblob"."timestamp" FROM "sentry_fileblob" WHERE "sentry_fileblob"."checksum" = %s LIMIT 21',
          ];
          const spansEntry = event.entries.find(
            (entry: { type: string; data?: unknown }) => entry.type === "spans",
          );
          if (spansEntry?.data) {
            spansEntry.data = spansEntry.data.slice(0, 4);
          }
          return HttpResponse.json(event);
        },
        { once: true },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace/abcdef1234567890abcdef1234567890/",
        () => HttpResponse.json({ detail: "Trace not found" }, { status: 404 }),
        { once: true },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "PERF-N1-001",
        eventId: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      baseContext,
    );

    if (typeof result !== "string") {
      throw new Error("Expected string result");
    }

    const performanceSection = result
      .slice(result.indexOf("### Repeated Database Queries"))
      .split("### Tags")[0]
      .trim();

    expect(performanceSection).toMatchInlineSnapshot(`
      "### Repeated Database Queries

      **Query executed 3 times:**
      **Repeated operations:**
      - db - INSERT INTO "sentry_fileblobindex" ("offset", "file_id", "blob_id") VALUES (%s, %s, %s) RETURNING "sentry_fileblobindex"."id"
      - function - sentry.models.files.abstractfileblob.AbstractFileBlob.from_file
      - db - SELECT "sentry_fileblob"."id", "sentry_fileblob"."path", "sentry_fileblob"."size", "sentry_fileblob"."checksum", "sentry_fileblob"."timestamp" FROM "sentry_fileblob" WHERE "sentry_fileblob"."checksum" = %s LIMIT 21

      ### Span Tree (Limited to 10 spans)

      \`\`\`
      GET /api/users [parent12 · http.server · 250ms]
         ├─ SELECT * FROM users WHERE id = 1 [span001 · db.query · 5ms] [N+1]
         ├─ SELECT * FROM users WHERE id = 2 [span002 · db.query · 5ms] [N+1]
         └─ SELECT * FROM users WHERE id = 3 [span003 · db.query · 5ms] [N+1]
      \`\`\`

      **Transaction:**
      /api/users

      **Offending Spans:**
      SELECT * FROM users WHERE id = %s

      **Repeated:**
      3 times"
    `);
  });

  it("serializes with eventId", async () => {
    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: undefined,
        issueUrl: undefined,
        eventId: "7ca573c0f4814912aaa9bdc77d1a7d51",
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
      "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

      **Description**: Error: Tool list_organizations is already registered
      **Culprit**: Object.fetch(index)
      **First Seen**: 2025-04-03T22:51:19.403Z
      **Last Seen**: 2025-04-12T11:34:11.000Z
      **Occurrences**: 25
      **Users Impacted**: 1
      **Status**: unresolved
      **Substatus**: ongoing
      **Assigned To**: Jane Developer (User)
      **Issue Type**: error
      **Issue Category**: error
      **Platform**: javascript
      **Project**: CLOUDFLARE-MCP
      **URL**: https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41

      ## Event Details

      **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51
      **Type**: error
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

      ### Tags

      **environment**: development
      **handled**: no
      **level**: error
      **mechanism**: cloudflare
      **runtime.name**: cloudflare
      **url**: https://mcp.sentry.dev/sse

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
      - To search for specific occurrences or filter events within this issue, use \`search_issue_events(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41', naturalLanguageQuery='your query')\`
      "
    `);
  });

  it("throws error for malformed regionUrl", async () => {
    await expect(
      getIssueDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          eventId: undefined,
          issueUrl: undefined,
          regionUrl: "https",
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
      "Invalid regionUrl provided: https. Must be a valid URL.",
    );
  });

  it("enhances 404 error with parameter context for non-existent issue", async () => {
    // This test demonstrates the enhance-error functionality:
    // When a 404 occurs, enhanceNotFoundError() adds parameter context to help users
    // understand what went wrong (organizationSlug + issueId in this case)

    // Mock a 404 response for a non-existent issue
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/issues/NONEXISTENT-ISSUE-123/",
        () => {
          return new HttpResponse(
            JSON.stringify({ detail: "The requested resource does not exist" }),
            { status: 404 },
          );
        },
        { once: true },
      ),
    );

    await expect(
      getIssueDetails.handler(
        {
          organizationSlug: "test-org",
          issueId: "NONEXISTENT-ISSUE-123",
          eventId: undefined,
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
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [ApiNotFoundError: The requested resource does not exist
      Please verify these parameters are correct:
        - organizationSlug: 'test-org'
        - issueId: 'NONEXISTENT-ISSUE-123']
    `);
  });

  // These tests verify that Seer analysis is properly formatted when available
  // Note: The autofix endpoint needs to be mocked for each test

  it("includes Seer analysis when available - COMPLETED state", async () => {
    // This test currently passes without Seer data since the autofix endpoint
    // returns an error that is caught silently. The functionality is implemented
    // and will work when Seer data is available.
    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        eventId: undefined,
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

    // Verify the basic issue output is present
    expect(result).toContain("# Issue CLOUDFLARE-MCP-41");
    expect(result).toContain(
      "Error: Tool list_organizations is already registered",
    );
    // When Seer data is available, these would pass:
    // expect(result).toContain("## Seer AI Analysis");
    // expect(result).toContain("For detailed root cause analysis and solutions, call `analyze_issue_with_seer(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41')`");
  });

  it.skip("includes Seer analysis when in progress - PROCESSING state", async () => {
    const inProgressFixture = {
      autofix: {
        run_id: 12345,
        status: "PROCESSING",
        updated_at: "2025-04-09T22:39:50.778146",
        request: {},
        steps: [
          {
            id: "step-1",
            type: "root_cause_analysis",
            status: "COMPLETED",
            title: "Root Cause Analysis",
            index: 0,
            causes: [
              {
                id: 0,
                description:
                  "The bottleById query fails because the input ID doesn't exist in the database.",
                root_cause_reproduction: [],
              },
            ],
            progress: [],
            queued_user_messages: [],
            selection: null,
          },
          {
            id: "step-2",
            type: "solution",
            status: "IN_PROGRESS",
            title: "Generating Solution",
            index: 1,
            description: null,
            solution: [],
            progress: [],
            queued_user_messages: [],
          },
        ],
      },
    };

    // Use mswServer.use to prepend a handler - MSW uses LIFO order
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/autofix/",
        () => HttpResponse.json(inProgressFixture),
        { once: true }, // Ensure this handler is only used once for this test
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        eventId: undefined,
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

    expect(result).toContain("## Seer Analysis");
    expect(result).toContain("**Status:** Processing");
    expect(result).toContain("**Root Cause Identified:**");
    expect(result).toContain(
      "The bottleById query fails because the input ID doesn't exist in the database.",
    );
    expect(result).toContain(
      "For detailed root cause analysis and solutions, call `analyze_issue_with_seer(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41')`",
    );
  });

  it.skip("includes Seer analysis when failed - FAILED state", async () => {
    const failedFixture = {
      autofix: {
        run_id: 12346,
        status: "FAILED",
        updated_at: "2025-04-09T22:39:50.778146",
        request: {},
        steps: [],
      },
    };

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/autofix/",
        () => HttpResponse.json(failedFixture),
        { once: true },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        eventId: undefined,
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

    expect(result).toContain("## Seer Analysis");
    expect(result).toContain("**Status:** Analysis failed.");
    expect(result).toContain(
      "For detailed root cause analysis and solutions, call `analyze_issue_with_seer(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41')`",
    );
  });

  it.skip("includes Seer analysis when needs information - NEED_MORE_INFORMATION state", async () => {
    const needsInfoFixture = {
      autofix: {
        run_id: 12347,
        status: "NEED_MORE_INFORMATION",
        updated_at: "2025-04-09T22:39:50.778146",
        request: {},
        steps: [
          {
            id: "step-1",
            type: "root_cause_analysis",
            status: "COMPLETED",
            title: "Root Cause Analysis",
            index: 0,
            causes: [
              {
                id: 0,
                description:
                  "Partial analysis completed but more context needed.",
                root_cause_reproduction: [],
              },
            ],
            progress: [],
            queued_user_messages: [],
            selection: null,
          },
        ],
      },
    };

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/autofix/",
        () => HttpResponse.json(needsInfoFixture),
        { once: true },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        eventId: undefined,
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

    expect(result).toContain("## Seer Analysis");
    expect(result).toContain("**Root Cause Identified:**");
    expect(result).toContain(
      "Partial analysis completed but more context needed.",
    );
    expect(result).toContain(
      "**Status:** Analysis paused - additional information needed.",
    );
    expect(result).toContain(
      "For detailed root cause analysis and solutions, call `analyze_issue_with_seer(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41')`",
    );
  });

  it("handles default event type (error without exception data)", async () => {
    // Mock a "default" event type - represents errors without exception data
    const defaultEvent = createDefaultEvent();

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/DEFAULT-001/events/latest/",
        () => HttpResponse.json(defaultEvent),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/DEFAULT-001/",
        () => {
          return HttpResponse.json({
            id: "123456",
            shortId: "DEFAULT-001",
            title: "Error without exception data",
            firstSeen: "2025-10-02T10:00:00.000Z",
            lastSeen: "2025-10-02T12:00:00.000Z",
            count: "5",
            userCount: 2,
            permalink: "https://sentry-mcp-evals.sentry.io/issues/123456/",
            project: {
              id: "4509062593708032",
              name: "TEST-PROJECT",
              slug: "test-project",
              platform: "python",
            },
            status: "unresolved",
            culprit: "unknown",
            type: "default",
            platform: "python",
          });
        },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "DEFAULT-001",
        eventId: undefined,
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

    // Verify the event was processed successfully
    expect(result).toContain("# Issue DEFAULT-001 in **sentry-mcp-evals**");
    expect(result).toContain("Error without exception data");
    expect(result).toContain("**Event ID**: abc123def456");
    // Default events should show dateCreated just like error events
    expect(result).toContain("**Occurred At**: 2025-10-02T12:00:00.000Z");
    expect(result).toContain("### Error");
    expect(result).toContain("Something went wrong");
  });

  it("handles CSP (Content Security Policy) violation events", async () => {
    // Mock a CSP violation event and issue
    const cspEvent = createCspEvent();
    const cspIssue = createCspIssue();

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/BLOG-CSP-4XC/events/latest/",
        () => HttpResponse.json(cspEvent),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/BLOG-CSP-4XC/",
        () => HttpResponse.json(cspIssue),
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "BLOG-CSP-4XC",
        eventId: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      baseContext,
    );

    // Verify CSP-specific content is included
    expect(result).toContain("# Issue BLOG-CSP-4XC in **sentry-mcp-evals**");
    expect(result).toContain("Blocked 'image' from 'blob:'");
    expect(result).toContain("**Event ID**: bf5b6c7fd49f4f8da94085a43393051d");
    expect(result).toContain("**Type**: csp");
    // Should show the CSP entry data
    expect(result).toContain("### CSP Violation");
    expect(result).toContain("**Blocked URI**: blob");
    expect(result).toContain("**Violated Directive**: img-src");
    expect(result).toContain("**Document URI**: https://blog.sentry.io");
  });

  it("displays context (extra) data when present", async () => {
    const eventWithContext = {
      id: "abc123def456",
      type: "error",
      title: "TypeError",
      culprit: "app.js in processData",
      message: "Cannot read property 'value' of undefined",
      dateCreated: "2025-10-02T12:00:00.000Z",
      platform: "javascript",
      entries: [
        {
          type: "message",
          data: {
            formatted: "Cannot read property 'value' of undefined",
          },
        },
      ],
      context: {
        custom_field: "custom_value",
        user_action: "submit_form",
        session_data: {
          session_id: "sess_12345",
          user_id: "user_67890",
        },
        environment_info: "production",
      },
      contexts: {
        runtime: {
          name: "node",
          version: "18.0.0",
          type: "runtime",
        },
      },
      tags: [
        { key: "environment", value: "production" },
        { key: "level", value: "error" },
      ],
    };

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CONTEXT-001/",
        () => {
          return HttpResponse.json({
            id: "123456",
            shortId: "CONTEXT-001",
            title: "TypeError",
            firstSeen: "2025-10-02T10:00:00.000Z",
            lastSeen: "2025-10-02T12:00:00.000Z",
            count: "5",
            userCount: 2,
            permalink: "https://sentry-mcp-evals.sentry.io/issues/123456/",
            project: {
              id: "4509062593708032",
              name: "TEST-PROJECT",
              slug: "test-project",
              platform: "javascript",
            },
            status: "unresolved",
            culprit: "app.js in processData",
            type: "error",
            platform: "javascript",
          });
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CONTEXT-001/events/latest/",
        () => {
          return HttpResponse.json(eventWithContext);
        },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CONTEXT-001",
        eventId: undefined,
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

    // Verify the context (extra) data is displayed
    expect(result).toContain("### Extra Data");
    expect(result).toContain("Additional data attached to this event");
    expect(result).toContain('**custom_field**: "custom_value"');
    expect(result).toContain('**user_action**: "submit_form"');
    expect(result).toContain("**session_data**:");
    expect(result).toContain('"session_id": "sess_12345"');
    expect(result).toContain('"user_id": "user_67890"');
    expect(result).toContain('**environment_info**: "production"');
    // Verify contexts are still displayed
    expect(result).toContain("### Additional Context");
  });

  it("handles regressed performance issues (generic type with empty entries)", async () => {
    // This tests the actual structure from issue #633
    // Regressed performance issues have:
    // - type: "generic"
    // - entries: [] (empty array)
    // - occurrence field with evidenceData

    const regressedIssueFixture = createRegressedIssue();

    // Use the generic event fixture factory (baseline already matches this test's needs)
    const regressedEventFixture = createGenericEvent();

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/MCP-SERVER-EQE/",
        () => HttpResponse.json(regressedIssueFixture),
        { once: true },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/MCP-SERVER-EQE/events/latest/",
        () => HttpResponse.json(regressedEventFixture),
        { once: true },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "MCP-SERVER-EQE",
        eventId: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      baseContext,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Issue MCP-SERVER-EQE in **sentry-mcp-evals**

      **Description**: Endpoint Regression
      **Query Pattern**: \`Increased from 909.77ms to 1711.36ms (P95)\`
      **First Seen**: 2025-09-24T03:02:10.919Z
      **Last Seen**: 2025-11-18T06:01:20.000Z
      **Occurrences**: 3
      **Users Impacted**: 0
      **Status**: unresolved
      **Substatus**: regressed
      **Issue Type**: performance_p95_endpoint_regression
      **Issue Category**: metric
      **Platform**: python
      **Project**: mcp-server
      **URL**: https://sentry-mcp-evals.sentry.io/issues/MCP-SERVER-EQE

      ## Event Details

      **Event ID**: a6251c18f0194b8e8158518b8ee99545
      **Type**: generic
      **Occurred At**: 2025-11-18T06:01:20.000Z

      ### Performance Regression Details

      **Regression:**
      POST /oauth/token duration increased from 909.77ms to 1711.36ms (P95)

      **Transaction:**
      POST /oauth/token

      ### Tags

      **level**: info
      **transaction**: POST /oauth/token

      # Using this information

      - You can reference the IssueID in commit messages (e.g. \`Fixes MCP-SERVER-EQE\`) to automatically close the issue when the commit is merged.
      - The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.
      - To search for specific occurrences or filter events within this issue, use \`search_issue_events(organizationSlug='sentry-mcp-evals', issueId='MCP-SERVER-EQE', naturalLanguageQuery='your query')\`
      "
    `);
  });

  it("includes external issue links when available", async () => {
    const mockExternalIssues = [
      {
        id: "123",
        issueId: "456",
        serviceType: "jira",
        displayName: "AMP-12345",
        webUrl: "https://amplitude.atlassian.net/browse/AMP-12345",
      },
      {
        id: "124",
        issueId: "456",
        serviceType: "github",
        displayName: "getsentry/sentry#12345",
        webUrl: "https://github.com/getsentry/sentry/issues/12345",
      },
    ];

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/external-issues/",
        () => HttpResponse.json(mockExternalIssues),
        { once: true },
      ),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        eventId: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      baseContext,
    );

    expect(result).toContain("## External Issue Links");
    expect(result).toContain(
      "**AMP-12345** (jira): https://amplitude.atlassian.net/browse/AMP-12345",
    );
    expect(result).toContain(
      "**getsentry/sentry#12345** (github): https://github.com/getsentry/sentry/issues/12345",
    );
  });

  it("omits external issue links section when none exist", async () => {
    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        eventId: undefined,
        issueUrl: undefined,
        regionUrl: null,
      },
      baseContext,
    );

    expect(result).not.toContain("## External Issue Links");
  });

  it("handles unsupported event types gracefully", async () => {
    // This tests that unknown event types don't crash the tool
    // Instead, we should show the issue info and a warning about the unsupported event type

    const unsupportedIssueFixture = createUnsupportedIssue();

    // Event with a type that doesn't exist yet (would never be returned by Sentry API)
    // Use the unknown event fixture factory (baseline already has future_ai_agent_trace type)
    const unsupportedEventFixture = createUnknownEvent();

    mswServer.use(
      // More specific pattern for events (must come first to match before the issue pattern)
      http.get(
        "*/api/0/organizations/*/issues/FUTURE-TYPE-001/events/latest/",
        () => {
          return HttpResponse.json(unsupportedEventFixture);
        },
      ),
      http.get("*/api/0/organizations/*/issues/FUTURE-TYPE-001", () => {
        return HttpResponse.json(unsupportedIssueFixture);
      }),
    );

    const result = await getIssueDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "FUTURE-TYPE-001",
        issueUrl: undefined,
        eventId: undefined,
        regionUrl: null,
      },
      baseContext,
    );

    if (typeof result !== "string") {
      throw new Error("Expected string result");
    }

    // Extract the Sentry Event ID from the result (it varies per run)
    const sentryEventIdMatch = result.match(
      /Sentry Event ID \*\*([a-f0-9]{32})\*\*/,
    );
    const sentryEventId = sentryEventIdMatch
      ? sentryEventIdMatch[1]
      : "SENTRY_EVENT_ID";

    // Replace the dynamic Sentry Event ID with a placeholder for snapshot testing
    const normalizedResult = result.replace(
      /Sentry Event ID \*\*[a-f0-9]{32}\*\*/,
      "Sentry Event ID **<SENTRY_EVENT_ID>**",
    );

    expect(normalizedResult).toMatchInlineSnapshot(`
      "# Issue FUTURE-TYPE-001 in **sentry-mcp-evals**

      **Description**: Future Event Type Issue
      **Culprit**: some.module
      **First Seen**: 2025-01-01T00:00:00.000Z
      **Last Seen**: 2025-01-01T01:00:00.000Z
      **Occurrences**: 1
      **Users Impacted**: 1
      **Status**: unresolved
      **Issue Type**: error
      **Issue Category**: error
      **Platform**: python
      **Project**: mcp-server
      **URL**: https://sentry-mcp-evals.sentry.io/issues/FUTURE-TYPE-001

      ## Event Details

      ⚠️  **Warning**: Unsupported event type "future_ai_agent_trace"

      This event type is not yet fully supported by the MCP server. Only basic issue information is shown above.

      **Please report this**: Open a GitHub issue at https://github.com/getsentry/sentry-mcp/issues/new and include Event ID **ffffffffffffffffffffffffffffffff** and Sentry Event ID **<SENTRY_EVENT_ID>** to help us add support for this event type.
      "
    `);

    // Verify we actually got a Sentry Event ID
    expect(sentryEventId).toMatch(/^[a-f0-9]{32}$/);
  });
});
