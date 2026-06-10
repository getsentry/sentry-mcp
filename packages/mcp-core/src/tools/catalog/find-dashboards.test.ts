import { dashboardListFixture, mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import findDashboards from "./find-dashboards.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

const projectConstrainedContext = {
  ...context,
  constraints: {
    ...context.constraints,
    projectSlug: "cloudflare-mcp",
  },
};

describe("find_dashboards", () => {
  it("lists dashboards with pagination hints", async () => {
    const result = await findDashboards.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        titleQuery: null,
        sort: "title",
        cursor: null,
        limit: 1,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Dashboards in **sentry-mcp-evals**

      ## Errors Overview

      **ID**: 101
      **Widgets**: 2
      **Widget Types**: line, table
      **Projects**: 4509106749636608
      **Environments**: production
      **Created By**: Jane Developer
      **Created**: 2025-04-14T10:15:00.000Z
      **Last Visited**: 2025-04-15T12:00:00.000Z
      **Favorited**: yes
      **URL**: [Open Dashboard](https://sentry-mcp-evals.sentry.io/dashboard/101/?project=4509106749636608)

      ## Response Notes

      - Use \`get_dashboard_details\` with the dashboard ID for widgets and query definitions.
      - More dashboards are available. Pass \`cursor: "dashboard-cursor"\` to fetch the next page.
      "
    `);
  });

  it("shows an empty title search", async () => {
    const result = await findDashboards.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        titleQuery: "missing",
        sort: "title",
        cursor: null,
        limit: 10,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Dashboards in **sentry-mcp-evals**

      **Title query:** "missing"

      No dashboards found matching "missing".
      "
    `);
  });

  it("filters explicit dashboard project IDs in project-constrained sessions", async () => {
    let requestUrl: string | null = null;
    const paths: string[] = [];
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          return HttpResponse.json({
            id: "4509109104082945",
            slug: "cloudflare-mcp",
            name: "cloudflare-mcp",
          });
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/dashboards/",
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          requestUrl = request.url;
          return HttpResponse.json(dashboardListFixture);
        },
      ),
    );

    const result = await findDashboards.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        titleQuery: null,
        sort: "title",
        cursor: null,
        limit: 10,
      },
      projectConstrainedContext,
    );

    if (!requestUrl) {
      throw new Error("Expected dashboard list request to be captured.");
    }
    const searchParams = new URL(requestUrl).searchParams;
    expect(searchParams.has("project")).toBe(false);
    expect(paths).toEqual([
      "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
      "/api/0/organizations/sentry-mcp-evals/dashboards/",
    ]);
    expect(result).not.toContain("**ID**: 101");
    expect(result).toContain("## Errors Overview Copy");
    expect(result).toContain("**ID**: 102");
    expect(result).toContain(
      "https://sentry-mcp-evals.sentry.io/dashboard/102/?project=4509109104082945",
    );
  });

  it("passes search, sort, cursor, and limit query parameters", async () => {
    let requestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/dashboards/",
        ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json(dashboardListFixture);
        },
      ),
    );

    await findDashboards.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        titleQuery: "errors",
        sort: "-dateCreated",
        cursor: "dashboard-cursor",
        limit: 25,
      },
      context,
    );

    if (!requestUrl) {
      throw new Error("Expected dashboard list request to be captured.");
    }
    const searchParams = new URL(requestUrl).searchParams;
    expect(searchParams.get("query")).toBe("errors");
    expect(searchParams.get("sort")).toBe("-dateCreated");
    expect(searchParams.get("cursor")).toBe("dashboard-cursor");
    expect(searchParams.get("per_page")).toBe("25");
  });
});
