import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content";
import findAlertRules, {
  findAlertRulesOutputSchema,
} from "./find-alert-rules.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

const issueAlertRule = {
  id: "123",
  name: "Notify backend team",
  enabled: true,
  config: {
    frequency: 30,
  },
  environment: "production",
  detectorIds: ["789"],
  owner: "team:backend",
  dateCreated: "2026-01-02T03:04:05.000Z",
  dateUpdated: "2026-01-02T04:04:05.000Z",
  triggers: {
    id: "trigger-1",
    logicType: "any",
    conditions: [
      {
        id: "condition-1",
        type: "event_frequency_count",
        comparison: 10,
        conditionResult: true,
      },
    ],
  },
  actionFilters: [
    {
      id: "filter-1",
      logicType: "all",
      conditions: [],
      actions: [
        {
          id: "action-1",
          type: "email",
          config: {
            targetType: "Team",
            targetIdentifier: "1",
          },
        },
      ],
    },
  ],
};

const metricAlertRule = {
  id: "456",
  name: "P95 latency",
  status: 0,
  dataset: "transactions",
  aggregate: "p95(transaction.duration)",
  query: "environment:production",
  timeWindow: 5,
  projects: ["cloudflare-mcp"],
  environment: "production",
  owner: "team:backend",
  dateCreated: "2026-01-03T03:04:05.000Z",
  triggers: [
    {
      label: "critical",
      alertThreshold: 500,
      actions: [
        {
          type: "slack",
          targetIdentifier: "alerts",
        },
      ],
    },
  ],
};

const project = {
  id: "4509109104082945",
  slug: "cloudflare-mcp",
  name: "cloudflare-mcp",
};

function useAlertRuleHandlers() {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
      () => HttpResponse.json(project),
    ),
    http.get(
      "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
      () => HttpResponse.json([issueAlertRule]),
    ),
    http.get(
      "https://sentry.io/api/0/organizations/sentry-mcp-evals/alert-rules/",
      () => HttpResponse.json([metricAlertRule]),
    ),
  );
}

describe("find_alert_rules", () => {
  it("serializes project-scoped issue and metric alert rules", async () => {
    useAlertRuleHandlers();
    let issueRequestUrl: string | null = null;
    let metricRequestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        ({ request }) => {
          issueRequestUrl = request.url;
          return HttpResponse.json([issueAlertRule]);
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/alert-rules/",
        ({ request }) => {
          metricRequestUrl = request.url;
          return HttpResponse.json([metricAlertRule]);
        },
      ),
    );

    const result = await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "all",
        projectSlug: "cloudflare-mcp",
        query: null,
        cursor: null,
        limit: 10,
      },
      context,
    );

    expect(issueRequestUrl).not.toBeNull();
    expect(new URL(issueRequestUrl ?? "").searchParams.get("projectSlug")).toBe(
      "cloudflare-mcp",
    );
    expect(metricRequestUrl).not.toBeNull();
    expect(new URL(metricRequestUrl ?? "").searchParams.get("project")).toBe(
      project.id,
    );
    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(findAlertRulesOutputSchema.parse(structuredContent)).toEqual(
      structuredContent,
    );
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "issueRules": [
          {
            "actionMatch": null,
            "dateCreated": "2026-01-02T03:04:05.000Z",
            "dateUpdated": "2026-01-02T04:04:05.000Z",
            "environment": "production",
            "filterMatch": null,
            "frequencyMinutes": 30,
            "id": "123",
            "lastTriggered": null,
            "name": "Notify backend team",
            "owner": "team:backend",
            "status": "enabled",
            "webUrl": "https://sentry-mcp-evals.sentry.io/monitors/alerts/123/",
          },
        ],
        "metricRules": [
          {
            "aggregate": "p95(transaction.duration)",
            "dataset": "transactions",
            "dateCreated": "2026-01-03T03:04:05.000Z",
            "environment": "production",
            "id": "456",
            "name": "P95 latency",
            "owner": "team:backend",
            "projects": [
              "cloudflare-mcp",
            ],
            "query": "environment:production",
            "status": 0,
            "timeWindowMinutes": 5,
            "webUrl": "https://sentry-mcp-evals.sentry.io/issues/alerts/rules/details/456/",
          },
        ],
        "pagination": {
          "issue": {
            "nextCursor": null,
          },
          "metric": {
            "nextCursor": null,
          },
        },
      }
    `);
  });

  it("lists organization metric alerts when no project is available", async () => {
    useAlertRuleHandlers();

    const result = await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "all",
        projectSlug: null,
        query: null,
        cursor: null,
        limit: 10,
      },
      context,
    );

    expect(getStructuredContent(result)).toMatchObject({
      issueRules: [],
      metricRules: [{ id: "456", name: "P95 latency" }],
      pagination: {
        issue: null,
        metric: { nextCursor: null },
      },
    });
  });

  it("resolves project redirects before listing metric alerts", async () => {
    let metricRequestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/legacy-cloudflare-mcp/",
        () => HttpResponse.json(project),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/alert-rules/",
        ({ request }) => {
          metricRequestUrl = request.url;
          return HttpResponse.json([metricAlertRule]);
        },
      ),
    );

    await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "metric",
        projectSlug: "legacy-cloudflare-mcp",
        query: null,
        cursor: null,
        limit: 10,
      },
      context,
    );

    expect(metricRequestUrl).not.toBeNull();
    expect(new URL(metricRequestUrl ?? "").searchParams.get("project")).toBe(
      project.id,
    );
  });

  it("returns next cursors for direct alert rule list endpoints", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        () =>
          HttpResponse.json([issueAlertRule], {
            headers: {
              Link: '<https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/?cursor=issue-page-2>; rel="next"; results="true"; cursor="issue-page-2"',
            },
          }),
      ),
    );

    const result = await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        query: null,
        cursor: null,
        limit: 10,
      },
      context,
    );

    expect(getStructuredContent(result).pagination).toEqual({
      issue: { nextCursor: "issue-page-2" },
      metric: null,
    });
  });

  it("uses workflows for issue query searches and combined-rules for metric query searches", async () => {
    let issueRequestUrl: string | null = null;
    const combinedRequestUrls: string[] = [];
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        ({ request }) => {
          issueRequestUrl = request.url;
          return HttpResponse.json([issueAlertRule]);
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        ({ request }) => {
          combinedRequestUrls.push(request.url);
          return HttpResponse.json([metricAlertRule]);
        },
      ),
    );

    const result = await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "all",
        projectSlug: "cloudflare-mcp",
        query: "backend",
        cursor: null,
        limit: 10,
      },
      context,
    );

    const structuredContent = getStructuredContent(result);
    expect(structuredContent.issueRules).toMatchObject([
      { id: "123", name: "Notify backend team" },
    ]);
    expect(structuredContent.metricRules).toMatchObject([
      { id: "456", name: "P95 latency" },
    ]);
    expect(issueRequestUrl).not.toBeNull();
    const issueParams = new URL(issueRequestUrl ?? "").searchParams;
    expect(issueParams.get("query")).toBe('name:"*backend*"');
    expect(issueParams.get("projectSlug")).toBe("cloudflare-mcp");
    expect(combinedRequestUrls).toHaveLength(1);
    const metricParams = new URL(combinedRequestUrls[0]).searchParams;
    expect(metricParams.get("name")).toBe("backend");
    expect(metricParams.get("query")).toBeNull();
    expect(metricParams.get("project")).toBe(project.id);
    expect(metricParams.get("alertType")).toBe("alert_rule");
  });

  it("filters unattached organization workflows from project-scoped issue results", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        () =>
          HttpResponse.json([
            {
              ...issueAlertRule,
              id: "999",
              name: "Organization workflow",
              detectorIds: [],
            },
            issueAlertRule,
          ]),
      ),
    );

    const result = await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        query: null,
        cursor: null,
        limit: 10,
      },
      context,
    );

    expect(getStructuredContent(result).issueRules).toMatchObject([
      { id: "123", name: "Notify backend team" },
    ]);
  });

  it("follows workflow pages until enough attached issue rules are found", async () => {
    const requestUrls: string[] = [];
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        ({ request }) => {
          requestUrls.push(request.url);
          const params = new URL(request.url).searchParams;
          if (params.get("cursor") === "workflow-page-2") {
            return HttpResponse.json([issueAlertRule]);
          }
          return HttpResponse.json(
            [
              {
                ...issueAlertRule,
                id: "999",
                name: "Organization workflow",
                detectorIds: [],
              },
            ],
            {
              headers: {
                Link: '<https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/?cursor=workflow-page-2>; rel="next"; results="true"; cursor="workflow-page-2"',
              },
            },
          );
        },
      ),
    );

    const result = await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        query: null,
        cursor: null,
        limit: 1,
      },
      context,
    );

    expect(requestUrls).toHaveLength(2);
    expect(new URL(requestUrls[1]).searchParams.get("cursor")).toBe(
      "workflow-page-2",
    );
    expect(getStructuredContent(result).issueRules).toMatchObject([
      { id: "123", name: "Notify backend team" },
    ]);
  });

  it("does not expose a workflow cursor when an overfull page is capped", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        () =>
          HttpResponse.json(
            [
              issueAlertRule,
              {
                ...issueAlertRule,
                id: "124",
                name: "Notify frontend team",
              },
            ],
            {
              headers: {
                Link: '<https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/?cursor=workflow-page-2>; rel="next"; results="true"; cursor="workflow-page-2"',
              },
            },
          ),
      ),
    );

    const result = await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        query: null,
        cursor: null,
        limit: 1,
      },
      context,
    );

    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toMatchInlineSnapshot(`
      {
        "issueRules": [
          {
            "actionMatch": null,
            "dateCreated": "2026-01-02T03:04:05.000Z",
            "dateUpdated": "2026-01-02T04:04:05.000Z",
            "environment": "production",
            "filterMatch": null,
            "frequencyMinutes": 30,
            "id": "123",
            "lastTriggered": null,
            "name": "Notify backend team",
            "owner": "team:backend",
            "status": "enabled",
            "webUrl": "https://sentry-mcp-evals.sentry.io/monitors/alerts/123/",
          },
        ],
        "metricRules": [],
        "pagination": {
          "issue": {
            "nextCursor": null,
          },
          "metric": null,
        },
      }
    `);
  });

  it("returns next cursors for combined-rules query searches", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          return HttpResponse.json(
            params.get("alertType") === "alert_rule" ? [metricAlertRule] : [],
            {
              headers: {
                Link: '<https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/?cursor=metric-query-page-2>; rel="next"; results="true"; cursor="metric-query-page-2"',
              },
            },
          );
        },
      ),
    );

    const result = await findAlertRules.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "metric",
        projectSlug: "cloudflare-mcp",
        query: "latency",
        cursor: null,
        limit: 10,
      },
      context,
    );

    expect(getStructuredContent(result)).toMatchObject({
      metricRules: [{ id: "456", name: "P95 latency" }],
      pagination: {
        issue: null,
        metric: { nextCursor: "metric-query-page-2" },
      },
    });
  });

  it("rejects issue alert search without a project", async () => {
    await expect(
      findAlertRules.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          kind: "issue",
          projectSlug: null,
          query: null,
          cursor: null,
          limit: 10,
        },
        context,
      ),
    ).rejects.toThrow(
      "projectSlug is required when searching issue alert rules.",
    );
  });

  it("rejects shared cursors when searching issue and metric alerts together", async () => {
    await expect(
      findAlertRules.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          kind: "all",
          projectSlug: "cloudflare-mcp",
          query: null,
          cursor: "endpoint-specific-cursor",
          limit: 10,
        },
        context,
      ),
    ).rejects.toThrow(
      "cursor cannot be used with `kind='all'` when both issue and metric alert rules are included.",
    );
  });
});
