import { z } from "zod";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import listEvents from "./index.js";
import { UserInputError } from "../../errors.js";
import { getServerContext } from "../../test-setup.js";

describe("list_events", () => {
  // Note: The mock server has strict requirements for fields and sort parameters.
  // Tests use fields that match the mock's expectations.

  it("returns formatted error events with aggregation fields", async () => {
    // Mock expects: issue, title, project, last_seen(), count() and sort -count or -last_seen
    const result = await listEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        dataset: "errors",
        query: "",
        fields: ["issue", "title", "project", "last_seen()", "count()"],
        sort: "-count",
        projectSlug: null,
        environment: null,
        statsPeriod: "14d",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("Search Results");
    expect(result).toContain("View these results in Sentry");
  });

  // Note: Spans test skipped because the mock requires very strict parameters (useRpc=1, specific sort)
  // that are validated in the API client tests. Error events test above validates the tool works correctly.

  it("allows aggregation queries with custom fields", async () => {
    const result = await listEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        dataset: "errors",
        query: "",
        fields: ["issue", "title", "project", "last_seen()", "count()"],
        sort: "-count",
        projectSlug: null,
        environment: null,
        statsPeriod: "7d",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    // Should return results with aggregation fields
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result).toContain("Search Results");
  });

  it("returns formatted metrics aggregates", async () => {
    const result = await listEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        dataset: "metrics",
        query: "",
        fields: [
          "transaction",
          "p95(value,http.request.duration,distribution,millisecond)",
          "count(value,http.request.duration,distribution,millisecond)",
        ],
        sort: "-p95(value,http.request.duration,distribution,millisecond)",
        projectSlug: null,
        environment: null,
        statsPeriod: "14d",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("Search Results");
    expect(result).toContain("GET /api/users");
    expect(result).toContain("/explore/metrics/");
  });

  it("returns metrics sample links with concrete metric identity", async () => {
    const result = await listEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        dataset: "metrics",
        query: "",
        fields: null,
        sort: "-timestamp",
        projectSlug: null,
        environment: null,
        statsPeriod: "14d",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(typeof result).toBe("string");
    if (typeof result !== "string") {
      throw new Error("Expected string result");
    }

    const urlMatch = result.match(/https:\/\/[^\n]+/);
    expect(urlMatch).not.toBeNull();

    const url = new URL(urlMatch![0]);
    const metricQuery = JSON.parse(url.searchParams.get("metric")!);

    expect(url.pathname).toBe("/explore/metrics/");
    expect(metricQuery.metric).toEqual({
      name: "http.request.duration",
      type: "distribution",
      unit: "millisecond",
    });
    expect(metricQuery.mode).toBe("samples");
    expect(metricQuery.aggregateFields).toEqual([{ yAxes: ["sum(value)"] }]);
  });

  it("returns formatted replay results when dataset is replays", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/replays/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.getAll("environment")).toEqual([
            "production",
            "staging",
          ]);
          return HttpResponse.json({
            data: [
              {
                id: "7e07485f12f9416b8b1426260799b51f",
                duration: 576,
                environment: "production",
                count_errors: 2,
                count_rage_clicks: 1,
                count_dead_clicks: 3,
                started_at: "2025-01-15T10:00:00Z",
                browser: { name: "Chrome", version: "131.0.0" },
                user: { display_name: "Jane Doe" },
                urls: ["/checkout", "/checkout/payment", "/checkout/confirm"],
                releases: ["frontend@1.2.3"],
                trace_ids: ["a4d1aae7216b47ff8117cf4e09ce9d0a"],
              },
            ],
          });
        },
      ),
    );

    const result = await listEvents.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        dataset: "replays",
        query: "count_rage_clicks:>0",
        fields: null,
        sort: "-count_rage_clicks",
        projectSlug: null,
        environment: ["production", "staging"],
        statsPeriod: "7d",
        limit: 10,
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result).toContain("/explore/replays/");
    expect(result).toContain("environment=production&environment=staging");
    expect(result).toContain("replay");
  });

  it("uses the replay default sort when replay sort is omitted", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/replays/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("sort")).toBe("-started_at");
          return HttpResponse.json({
            data: [
              {
                id: "7e07485f12f9416b8b1426260799b51f",
                duration: 576,
                environment: "production",
                count_errors: 2,
                count_rage_clicks: 1,
                count_dead_clicks: 3,
                started_at: "2025-01-15T10:00:00Z",
                browser: { name: "Chrome", version: "131.0.0" },
                user: { display_name: "Jane Doe" },
                urls: ["/checkout"],
                releases: ["frontend@1.2.3"],
                trace_ids: ["a4d1aae7216b47ff8117cf4e09ce9d0a"],
              },
            ],
          });
        },
      ),
    );

    const parsed = z.object(listEvents.inputSchema).parse({
      organizationSlug: "sentry-mcp-evals",
      dataset: "replays",
      query: "count_errors:>0",
    });

    expect(parsed.sort).toBeNull();

    const result = await listEvents.handler(parsed, getServerContext());

    expect(result).toContain("sort=-started_at");
    expect(result).toContain("/explore/replays/");
  });

  it("rejects environment as a top-level parameter for non-replay datasets", async () => {
    await expect(
      listEvents.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          dataset: "errors",
          query: "",
          fields: null,
          sort: "-timestamp",
          projectSlug: null,
          environment: "production",
          statsPeriod: "14d",
          limit: 10,
          regionUrl: null,
        },
        getServerContext(),
      ),
    ).rejects.toThrow(UserInputError);
  });
});
