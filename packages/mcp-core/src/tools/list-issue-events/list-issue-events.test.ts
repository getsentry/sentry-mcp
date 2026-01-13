import { describe, it, expect } from "vitest";
import { UserInputError } from "../../errors.js";
import listIssueEvents from "./index.js";
import { getServerContext } from "../../test-setup.js";

describe("list_issue_events", () => {
  it("returns formatted events using issueId and organizationSlug", async () => {
    const result = await listIssueEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        issueUrl: undefined,
        query: "",
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 50,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("Search Results");
    expect(result).toContain("View these results in Sentry");
    expect(result).toContain("CLOUDFLARE-MCP-41");
  });

  it("returns formatted events using issueUrl", async () => {
    const result = await listIssueEvents.handler(
      {
        organizationSlug: null,
        issueId: undefined,
        issueUrl:
          "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/",
        query: "",
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 50,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("Search Results");
  });

  it("filters events by query", async () => {
    const result = await listIssueEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        issueUrl: undefined,
        query: "environment:production",
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 50,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("Search Results");
    // Query is URL-encoded in the explorer link
    expect(result).toContain("environment%3Aproduction");
  });

  it("respects sort parameter", async () => {
    const result = await listIssueEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        issueUrl: undefined,
        query: "",
        sort: "timestamp",
        statsPeriod: "14d",
        limit: 50,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("Search Results");
  });

  it("respects limit parameter", async () => {
    const result = await listIssueEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        issueUrl: undefined,
        query: "",
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 5,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("Search Results");
  });

  it("throws error when neither issueId nor issueUrl provided", async () => {
    await expect(
      listIssueEvents.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: undefined,
          issueUrl: undefined,
          query: "",
          sort: "-timestamp",
          statsPeriod: "14d",
          limit: 50,
          regionUrl: null,
        },
        getServerContext(),
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("throws error when issueId provided without organizationSlug", async () => {
    await expect(
      listIssueEvents.handler(
        {
          organizationSlug: null,
          issueId: "CLOUDFLARE-MCP-41",
          issueUrl: undefined,
          query: "",
          sort: "-timestamp",
          statsPeriod: "14d",
          limit: 50,
          regionUrl: null,
        },
        getServerContext(),
      ),
    ).rejects.toThrow(UserInputError);
  });
});
