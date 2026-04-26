import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import listIssues from "./index.js";
import { getServerContext } from "../../test-setup.js";

describe("list_issues", () => {
  it("returns formatted issue list with default query", async () => {
    const result = await listIssues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: "is:unresolved",
        projectSlugOrId: null,
        sort: "date",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("# Issues in **sentry-mcp-evals**");
    expect(result).toContain("CLOUDFLARE-MCP-41");
    expect(result).toContain("Tool list_organizations is already registered");
  });

  it("returns formatted issue list with project filter", async () => {
    const result = await listIssues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: "is:unresolved",
        projectSlugOrId: "cloudflare-mcp",
        sort: "date",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    // When project is specified, it's included in the header
    expect(result).toContain("# Issues in **sentry-mcp-evals/cloudflare-mcp**");
    expect(result).toContain("CLOUDFLARE-MCP-41");
  });

  it("handles empty results gracefully", async () => {
    // Using a project that has no issues
    const result = await listIssues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: "is:unresolved",
        projectSlugOrId: "foobar",
        sort: "date",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("No issues found");
  });

  it("uses correct sort order", async () => {
    const result = await listIssues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: "is:unresolved",
        projectSlugOrId: null,
        sort: "freq",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("# Issues in **sentry-mcp-evals**");
  });

  it("respects limit parameter", async () => {
    const result = await listIssues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: "is:unresolved",
        projectSlugOrId: null,
        sort: "date",
        limit: 1,
        regionUrl: null,
      },
      getServerContext(),
    );

    // Should still return results (limited to 1)
    expect(result).toContain("# Issues in **sentry-mcp-evals**");
  });

  it("uses configured host and protocol for self-hosted issue URLs", async () => {
    mswServer.use(
      http.get(
        "http://sentry.internal:9000/api/0/organizations/sentry-mcp-evals/issues/",
        () =>
          HttpResponse.json([
            {
              id: "1",
              shortId: "TEST-1",
              title: "Self-hosted issue",
              culprit: "test",
              permalink: "http://sentry.internal:9000/issues/1/",
              level: "error",
              status: "unresolved",
              statusDetails: {},
              isPublic: false,
              platform: "javascript",
              project: { id: "1", name: "test", slug: "test", platform: "" },
              type: "error",
              metadata: {},
              numComments: 0,
              isBookmarked: false,
              isSubscribed: false,
              hasSeen: true,
              annotations: [],
              issueType: "error",
              issueCategory: "error",
              firstSeen: "2024-01-01T00:00:00Z",
              lastSeen: "2024-01-01T00:00:00Z",
              count: "1",
              userCount: 1,
              stats: {},
            },
          ]),
      ),
    );

    const result = await listIssues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: "is:unresolved",
        projectSlugOrId: null,
        sort: "date",
        limit: 10,
        regionUrl: null,
      },
      getServerContext({
        sentryHost: "sentry.internal:9000",
        sentryProtocol: "http",
      }),
    );

    expect(result).toContain(
      "http://sentry.internal:9000/organizations/sentry-mcp-evals/issues/TEST-1",
    );
    expect(result).not.toContain("https://sentry.io/");
  });
});
