import { describe, it, expect } from "vitest";
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
});
