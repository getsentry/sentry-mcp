import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import findMonitors from "./find-monitors.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("find_monitors", () => {
  it("serializes cron monitors", async () => {
    const result = await findMonitors.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: null,
        environment: null,
        owner: null,
        query: null,
        limit: 10,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Cron Monitors in **sentry-mcp-evals**

      ## Nightly Import

      **Slug**: nightly-import
      **ID**: 4509100000000001
      **Project**: cloudflare-mcp
      **Status**: ok
      **Owner**: the-goats
      **Last Check-In**: 2025-04-14T02:00:13.000Z
      **Next Check-In**: 2025-04-15T02:00:00.000Z
      **URL**: [Open Monitor](https://sentry-mcp-evals.sentry.io/crons/cloudflare-mcp/nightly-import/)

      ### Schedule

      **schedule**: ["crontab","0 2 * * *"]
      **schedule_type**: crontab
      **checkin_margin**: 5
      **max_runtime**: 30

      ### Environments

      - production - ok (last check-in 2025-04-14T02:00:13.000Z)
      - staging - missed_checkin (last check-in 2025-04-13T02:00:18.000Z)

      ## Response Notes

      - Use \`get_monitor_details\` with a monitor slug for check-ins and stats.
      - Monitor issue searches commonly use \`monitor.slug:<slug>\`.
      "
    `);
  });

  it("filters by projectSlug instead of numeric project for project slugs", async () => {
    let requestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/monitors/",
        ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json([]);
        },
      ),
    );

    await findMonitors.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: "backend",
        environment: null,
        owner: null,
        query: null,
        limit: 10,
      },
      context,
    );

    expect(requestUrl).not.toBeNull();
    const params = new URL(requestUrl ?? "").searchParams;
    expect(params.get("projectSlug")).toBe("backend");
    expect(params.get("project")).toBeNull();
  });

  it("sends monitor list filters to Sentry", async () => {
    let requestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/monitors/",
        ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json([]);
        },
      ),
    );

    await findMonitors.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: "backend",
        environment: "production",
        owner: "team:123",
        query: "billing",
        limit: 25,
      },
      context,
    );

    expect(requestUrl).not.toBeNull();
    const params = new URL(requestUrl ?? "").searchParams;
    expect(params.get("projectSlug")).toBe("backend");
    expect(params.get("environment")).toBe("production");
    expect(params.get("owner")).toBe("team:123");
    expect(params.get("query")).toBe("billing");
    expect(params.get("per_page")).toBe("25");
  });

  it("uses the active project constraint as the monitor list project", async () => {
    let requestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/monitors/",
        ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json([]);
        },
      ),
    );

    await findMonitors.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: "all",
        environment: null,
        owner: null,
        query: null,
        limit: 10,
      },
      {
        ...context,
        constraints: {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "backend",
        },
      },
    );

    expect(requestUrl).not.toBeNull();
    const params = new URL(requestUrl ?? "").searchParams;
    expect(params.get("projectSlug")).toBe("backend");
  });

  it("rejects monitor list projects outside the active project constraint", async () => {
    await expect(
      findMonitors.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          projectSlug: "backend",
          environment: null,
          owner: null,
          query: null,
          limit: 10,
        },
        {
          ...context,
          constraints: {
            organizationSlug: "sentry-mcp-evals",
            projectSlug: "frontend",
          },
        },
      ),
    ).rejects.toThrow(
      'Monitor list is outside the active project constraint. Expected project "frontend".',
    );
  });

  it("encodes monitor slugs in web links", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/monitors/",
        () =>
          HttpResponse.json([
            {
              id: "4509100000000002",
              slug: "nightly/import 1",
              name: "Nightly Import 1",
              status: "ok",
              project: {
                id: "4509109104082945",
                slug: "cloudflare-mcp",
                name: "cloudflare-mcp",
              },
              config: {
                schedule_type: "crontab",
                schedule: ["crontab", "0 2 * * *"],
              },
              environments: [],
            },
          ]),
      ),
    );

    const result = await findMonitors.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: null,
        environment: null,
        owner: null,
        query: null,
        limit: 10,
      },
      context,
    );

    expect(result).toContain(
      "[Open Monitor](https://sentry-mcp-evals.sentry.io/crons/cloudflare-mcp/nightly%2Fimport%201/)",
    );
  });
});
