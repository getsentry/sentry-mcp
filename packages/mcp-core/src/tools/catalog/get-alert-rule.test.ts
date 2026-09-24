import { mswServer } from "@sentry/mcp-server-mocks";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { getStructuredContent } from "../../test-utils/structured-content";
import getAlertRule from "./get-alert-rule.js";

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
    organizationSlug: null,
    projectSlug: "cloudflare-mcp",
  },
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
          data: {},
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

const detector = {
  id: "789",
  name: "Error count",
  type: "metric_issue",
  workflowIds: ["123"],
  dateCreated: issueAlertRule.dateCreated,
  dateUpdated: issueAlertRule.dateUpdated,
  projectId: project.id,
  enabled: true,
  config: { detectionType: "static" },
  conditionGroup: {
    logicType: "any",
    conditions: [{ type: "gt", comparison: 10, conditionResult: 75 }],
  },
  dataSources: [
    {
      type: "snuba_query_subscription",
      organizationId: "private-org-id",
      queryObj: {
        subscription: "private-subscription",
        snubaQuery: {
          id: "private-query-id",
          dataset: "events",
          query: "level:error",
          aggregate: "count()",
          timeWindow: 300,
          environment: null,
          eventTypes: ["error"],
        },
      },
    },
  ],
};
const issueParams = {
  organizationSlug: "sentry-mcp-evals",
  regionUrl: null,
  kind: "issue" as const,
  projectSlug: null,
  ruleIdOrName: "123",
};

const organizationApi =
  "https://sentry.io/api/0/organizations/sentry-mcp-evals";
const projectApi =
  "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp";

function getRule(
  params: Partial<Parameters<typeof getAlertRule.handler>[0]> = {},
  toolContext: Parameters<typeof getAlertRule.handler>[1] = context,
) {
  return getAlertRule.handler({ ...issueParams, ...params }, toolContext);
}

function useAlertRuleHandlers() {
  mswServer.use(
    http.get(`${projectApi}/`, () => HttpResponse.json(project)),
    http.get(`${organizationApi}/workflows/`, () =>
      HttpResponse.json([issueAlertRule]),
    ),
    http.get(`${organizationApi}/workflows/:id/`, () =>
      HttpResponse.json(issueAlertRule),
    ),
    http.get(`${organizationApi}/workflows/:id/project-scope/`, () =>
      HttpResponse.json({
        projectIds: [project.id],
        includesAllProjects: false,
      }),
    ),
    http.get(`${organizationApi}/detectors/:id/`, () =>
      HttpResponse.json(detector),
    ),
    http.get(`${organizationApi}/alert-rules/456/`, () =>
      HttpResponse.json(metricAlertRule),
    ),
  );
}

describe("get_alert_rule", () => {
  beforeEach(useAlertRuleHandlers);
  it("gets an issue alert by numeric ID when kind is explicit", async () => {
    const result = await getRule({
      projectSlug: "cloudflare-mcp",
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "structuredContent": {
          "alertRule": {
            "actionFilters": [
              {
                "actions": [
                  {
                    "config": {
                      "targetIdentifier": "1",
                      "targetType": "Team",
                    },
                    "data": {},
                    "id": "action-1",
                    "type": "email",
                  },
                ],
                "conditions": [],
                "id": "filter-1",
                "logicType": "all",
              },
            ],
            "config": {
              "frequency": 30,
            },
            "dateCreated": "2026-01-02T03:04:05.000Z",
            "dateUpdated": "2026-01-02T04:04:05.000Z",
            "enabled": true,
            "environment": "production",
            "id": "123",
            "lastTriggered": null,
            "name": "Notify backend team",
            "owner": "team:backend",
            "scope": {
              "includesAllProjects": false,
              "projectIds": [
                "4509109104082945",
              ],
            },
            "sources": [
              {
                "conditionGroup": {
                  "conditions": [
                    {
                      "comparison": 10,
                      "conditionResult": 75,
                      "type": "gt",
                    },
                  ],
                  "logicType": "any",
                },
                "config": {
                  "detectionType": "static",
                },
                "dataSources": [
                  {
                    "query": {
                      "aggregate": "count()",
                      "dataset": "events",
                      "environment": null,
                      "eventTypes": [
                        "error",
                      ],
                      "query": "level:error",
                      "timeWindowSeconds": 300,
                    },
                    "type": "snuba_query_subscription",
                  },
                ],
                "enabled": true,
                "id": "789",
                "name": "Error count",
                "projectId": "4509109104082945",
                "status": "available",
                "type": "metric_issue",
              },
            ],
            "triggers": {
              "conditions": [
                {
                  "comparison": 10,
                  "conditionResult": true,
                  "id": "condition-1",
                  "type": "event_frequency_count",
                },
              ],
              "id": "trigger-1",
              "logicType": "any",
            },
            "webUrl": "https://sentry-mcp-evals.sentry.io/monitors/alerts/123/",
          },
        },
      }
    `);
  });

  it("gets a metric alert by numeric ID when kind is explicit", async () => {
    const result = await getRule({ kind: "metric", ruleIdOrName: "456" });

    expect(result).toMatchInlineSnapshot(`
      "# Alert Rule in **sentry-mcp-evals**

      ## P95 latency

      **Kind**: Metric Alert
      **ID**: 456
      **Status**: 0
      **Dataset**: transactions
      **Aggregate**: p95(transaction.duration)
      **Query**: environment:production
      **Time Window**: 5 minutes
      **Projects**: cloudflare-mcp
      **Environment**: production
      **Owner**: team:backend
      **Created**: 2026-01-03T03:04:05.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/issues/alerts/rules/details/456/

      ### Triggers

      - Trigger: Critical threshold: 500
      - Actions: Slack (target: alerts)

      ## Response Notes

      - Use these details to inspect alert conditions, filters, routing, and notification actions before changing the rule in Sentry.
      "
    `);
  });

  it("uses organization metric alert details for a project-scoped ID", async () => {
    mswServer.use(
      http.get(`${projectApi}/alert-rules/456/`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );

    const result = await getRule({
      kind: "metric",
      projectSlug: "cloudflare-mcp",
      ruleIdOrName: "456",
    });

    expect(result).toContain("**Kind**: Metric Alert");
    expect(result).toContain("**ID**: 456");
    expect(result).toContain("### Triggers");
  });

  it("rejects organization metric alert details outside the active project constraint", async () => {
    mswServer.use(
      http.get(`${organizationApi}/alert-rules/456/`, () =>
        HttpResponse.json({
          ...metricAlertRule,
          projects: ["frontend"],
        }),
      ),
    );

    await expect(
      getRule(
        { kind: "metric", ruleIdOrName: "456" },
        projectConstrainedContext,
      ),
    ).rejects.toThrow('Metric alert rule is outside project "cloudflare-mcp"');
  });

  it("uses organization metric alert details after resolving an exact name", async () => {
    mswServer.use(
      http.get(`${organizationApi}/combined-rules/`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get("alertType")).toBe("alert_rule");
        return HttpResponse.json([
          { id: metricAlertRule.id, name: metricAlertRule.name },
        ]);
      }),
      http.get(`${projectApi}/alert-rules/456/`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );

    const result = await getRule({
      kind: "metric",
      projectSlug: "cloudflare-mcp",
      ruleIdOrName: "P95 latency",
    });

    expect(result).toContain("**Kind**: Metric Alert");
    expect(result).toContain("**ID**: 456");
    expect(result).toContain("### Triggers");
  });

  it("fetches issue alert details after resolving an exact name", async () => {
    let listRequestUrl: string | null = null;
    mswServer.use(
      http.get(`${organizationApi}/workflows/`, ({ request }) => {
        listRequestUrl = request.url;
        return HttpResponse.json([
          {
            id: issueAlertRule.id,
            name: issueAlertRule.name,
            detectorIds: issueAlertRule.detectorIds,
          },
        ]);
      }),
    );

    const result = await getRule({
      projectSlug: "cloudflare-mcp",
      ruleIdOrName: "Notify backend team",
    });

    expect(listRequestUrl).not.toBeNull();
    const listParams = new URL(listRequestUrl ?? "").searchParams;
    expect(listParams.get("query")).toBe('name:"*Notify backend team*"');
    expect(listParams.get("projectSlug")).toBe("cloudflare-mcp");
    expect(getStructuredContent(result)).toMatchObject({
      alertRule: { triggers: issueAlertRule.triggers },
    });
  });

  it("quotes issue alert name lookups for workflow query syntax", async () => {
    let listRequestUrl: string | null = null;
    mswServer.use(
      http.get(`${organizationApi}/workflows/`, ({ request }) => {
        listRequestUrl = request.url;
        return HttpResponse.json([
          { ...issueAlertRule, name: "Critical: backend" },
        ]);
      }),
    );

    const result = await getRule({
      projectSlug: "cloudflare-mcp",
      ruleIdOrName: "Critical: backend",
    });

    expect(listRequestUrl).not.toBeNull();
    expect(new URL(listRequestUrl ?? "").searchParams.get("query")).toBe(
      'name:"*Critical: backend*"',
    );
    expect(getStructuredContent(result)).toMatchObject({
      alertRule: { id: "123" },
    });
  });

  it("inspects an unattached Alert organization-wide but rejects it in a constrained session", async () => {
    mswServer.use(
      http.get("*/workflows/123/", () =>
        HttpResponse.json({ ...issueAlertRule, detectorIds: [] }),
      ),
      http.get("*/workflows/123/project-scope/", () =>
        HttpResponse.json({ projectIds: [], includesAllProjects: false }),
      ),
    );
    expect(getStructuredContent(await getRule())).toMatchObject({
      alertRule: { sources: [], scope: { projectIds: [] } },
    });
    await expect(getRule({}, projectConstrainedContext)).rejects.toThrow();
  });

  it("resolves digit-only issue alert names after a numeric ID miss", async () => {
    mswServer.use(
      http.get("*/workflows/123/", () =>
        HttpResponse.json({ detail: "Not found" }, { status: 404 }),
      ),
      http.get("*/workflows/789/", () =>
        HttpResponse.json({ ...issueAlertRule, id: "789", name: "123" }),
      ),
      http.get(`${organizationApi}/workflows/`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get("query")).toBe('name:"*123*"');
        return HttpResponse.json([
          { ...issueAlertRule, id: "789", name: "123" },
        ]);
      }),
    );

    const result = await getRule({ projectSlug: "cloudflare-mcp" });

    expect(getStructuredContent(result)).toMatchObject({
      alertRule: { id: "789", name: "123" },
    });
  });

  it("treats digit-only values as exact names with kind all", async () => {
    mswServer.use(
      http.get(`${organizationApi}/workflows/`, () => HttpResponse.json([])),
      http.get(`${organizationApi}/combined-rules/`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get("alertType")).toBe("alert_rule");
        return HttpResponse.json([
          { ...metricAlertRule, id: "789", name: "123" },
        ]);
      }),
      http.get(`${projectApi}/alert-rules/789/`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
      http.get(`${organizationApi}/alert-rules/789/`, () =>
        HttpResponse.json({ ...metricAlertRule, id: "789", name: "123" }),
      ),
    );

    const result = await getRule({
      kind: "all",
      projectSlug: "cloudflare-mcp",
    });

    expect(result).toContain("## 123");
    expect(result).toContain("**Kind**: Metric Alert");
    expect(result).toContain("**ID**: 789");
  });

  it("rejects exact-name metric matches outside the active project constraint", async () => {
    mswServer.use(
      http.get(`${organizationApi}/workflows/`, () => HttpResponse.json([])),
      http.get(`${organizationApi}/combined-rules/`, () =>
        HttpResponse.json([metricAlertRule]),
      ),
      http.get(`${organizationApi}/alert-rules/456/`, () =>
        HttpResponse.json({
          ...metricAlertRule,
          projects: ["frontend"],
        }),
      ),
    );

    await expect(
      getRule(
        { kind: "all", ruleIdOrName: "P95 latency" },
        projectConstrainedContext,
      ),
    ).rejects.toThrow('Metric alert rule is outside project "cloudflare-mcp"');
  });

  it("rejects ambiguous exact-name lookups", async () => {
    mswServer.use(
      http.get(`${organizationApi}/workflows/`, () =>
        HttpResponse.json([{ ...issueAlertRule, name: "Same name" }]),
      ),
      http.get(`${organizationApi}/combined-rules/`, () =>
        HttpResponse.json([{ ...metricAlertRule, name: "Same name" }]),
      ),
    );

    await expect(
      getRule({
        kind: "all",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "Same name",
      }),
    ).rejects.toThrow('Multiple alert rules named "Same name" were found');
  });

  it("preserves complete groups and monitor matching context without backend metadata", async () => {
    const conditions = Array.from({ length: 6 }, (_, i) => ({
      ...issueAlertRule.triggers.conditions[0],
      id: `condition-${i}`,
    }));
    const actions = Array.from({ length: 6 }, (_, i) => ({
      ...issueAlertRule.actionFilters[0].actions[0],
      id: `action-${i}`,
    }));
    const groups = Array.from({ length: 6 }, (_, i) => ({
      ...issueAlertRule.actionFilters[0],
      id: `group-${i}`,
      conditions,
      actions,
    }));
    mswServer.use(
      http.get("*/workflows/123/", () =>
        HttpResponse.json({
          ...issueAlertRule,
          backendOnly: "private-field",
          actionFilters: groups,
          triggers: { ...issueAlertRule.triggers, conditions },
        }),
      ),
    );
    const result = await getRule();
    expect(getStructuredContent(result)).toMatchObject({
      alertRule: {
        triggers: { conditions },
        actionFilters: groups,
        sources: [
          {
            config: detector.config,
            conditionGroup: detector.conditionGroup,
            dataSources: [
              {
                query: {
                  query: "level:error",
                  aggregate: "count()",
                  timeWindowSeconds: 300,
                },
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-field|private-subscription|private-query-id|private-org-id/,
    );
  });

  it("marks inaccessible sources and redacts other projects in a shared Alert", async () => {
    mswServer.use(
      http.get("*/workflows/123/", () =>
        HttpResponse.json({
          ...issueAlertRule,
          detectorIds: ["789", "790", "791"],
        }),
      ),
      http.get("*/workflows/123/project-scope/", () =>
        HttpResponse.json({
          projectIds: [project.id, "other-project"],
          includesAllProjects: false,
        }),
      ),
      http.get("*/detectors/790/", () =>
        HttpResponse.json({
          ...detector,
          id: "790",
          projectId: "other-project",
          name: "Private monitor",
          config: { privateConfig: true },
        }),
      ),
      http.get("*/detectors/791/", () =>
        HttpResponse.json({ detail: "Forbidden" }, { status: 403 }),
      ),
    );
    const result = await getRule({}, projectConstrainedContext);
    expect(getStructuredContent(result)).toMatchObject({
      alertRule: {
        scope: {
          projectIds: [project.id],
          outsideProjectCount: 1,
          limitedToProject: project.slug,
        },
        sources: [
          { id: "789", status: "available" },
          { id: "790", status: "outside_project_constraint" },
          { id: "791", status: "unavailable" },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Private monitor|privateConfig|other-project/,
    );
  });

  it("exposes all-project scope without the issue stream's internal organization linkage", async () => {
    mswServer.use(
      http.get("*/workflows/123/project-scope/", () =>
        HttpResponse.json({ projectIds: [], includesAllProjects: true }),
      ),
      http.get("*/detectors/789/", () =>
        HttpResponse.json({
          ...detector,
          type: "issue_stream",
          projectId: null,
          config: { organizationId: "private-org" },
          dataSources: null,
          conditionGroup: null,
        }),
      ),
    );
    const result = await getRule({}, projectConstrainedContext);
    expect(getStructuredContent(result)).toMatchObject({
      alertRule: {
        scope: { includesAllProjects: true },
        sources: [{ projectId: null, config: {} }],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-org|outsideProjectCount/,
    );
  });

  it("projects Uptime and Cron configuration and marks unsupported sources", async () => {
    const uptime = {
      url: "https://example.com/health",
      method: "GET",
      intervalSeconds: 60,
      timeoutMs: 1000,
      assertion: null,
      headers: [["Authorization", "secret-header"]],
      body: "secret-body",
    };
    const cron = {
      id: "cron-id",
      name: "Daily job",
      slug: "daily-job",
      status: "active",
      isMuted: false,
      config: {
        schedule_type: "crontab",
        schedule: "0 0 * * *",
        timezone: null,
        alert_rule_id: "private-legacy-id",
      },
      environments: [],
    };
    mswServer.use(
      http.get("*/detectors/789/", () =>
        HttpResponse.json({
          ...detector,
          dataSources: [
            { type: "uptime_subscription", queryObj: uptime },
            { type: "cron_monitor", queryObj: cron },
            {
              type: "future_source",
              queryObj: { privateField: "private-value" },
            },
          ],
        }),
      ),
    );
    const result = await getRule();
    expect(getStructuredContent(result)).toMatchObject({
      alertRule: {
        sources: [
          {
            dataSources: [
              {
                type: "uptime_subscription",
                query: { url: uptime.url, timeoutMs: 1000 },
                omittedFields: ["headers", "body"],
              },
              {
                type: "cron_monitor",
                query: {
                  slug: cron.slug,
                  config: { schedule: "0 0 * * *", timezone: null },
                },
              },
              {
                type: "future_source",
                unavailableReason: expect.any(String),
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secret-header|secret-body|private-legacy-id|private-value/,
    );
  });

  it.each([
    ["snuba_query_subscription", { snubaQuery: null }],
    ["uptime_subscription", { url: "https://example.com/health" }],
    ["cron_monitor", { config: { schedule: "0 0 * * *" } }],
  ])("isolates incomplete %s source configuration", async (type, queryObj) => {
    mswServer.use(
      http.get("*/detectors/789/", () =>
        HttpResponse.json({
          ...detector,
          dataSources: [...detector.dataSources, { type, queryObj }],
        }),
      ),
    );
    expect(getStructuredContent(await getRule())).toEqual({
      alertRule: expect.objectContaining({
        id: issueAlertRule.id,
        triggers: issueAlertRule.triggers,
        actionFilters: issueAlertRule.actionFilters,
        sources: [
          expect.objectContaining({
            id: detector.id,
            status: "available",
            dataSources: [
              expect.objectContaining({
                type: "snuba_query_subscription",
                query: expect.objectContaining({ query: "level:error" }),
              }),
              { type, unavailableReason: expect.any(String) },
            ],
          }),
        ],
      }),
    });
  });

  it.each(["issue", "all"] as const)(
    "rejects incomplete name searches with kind %s",
    async (kind) => {
      mswServer.use(
        http.get("*/workflows/", () =>
          HttpResponse.json([issueAlertRule], {
            headers: {
              Link: '<https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/?cursor=next>; rel="next"; results="true"; cursor="next"',
            },
          }),
        ),
      );
      await expect(
        getRule({ kind, ruleIdOrName: issueAlertRule.name }),
      ).rejects.toThrow("name search is incomplete");
    },
  );

  it("rejects incomplete metric name searches even when a workflow already matches", async () => {
    mswServer.use(
      http.get(`${organizationApi}/combined-rules/`, () =>
        HttpResponse.json([], {
          headers: {
            Link: `<${organizationApi}/combined-rules/?cursor=next>; rel="next"; results="true"; cursor="next"`,
          },
        }),
      ),
    );
    await expect(
      getRule({ kind: "all", ruleIdOrName: issueAlertRule.name }),
    ).rejects.toThrow("name search is incomplete");
  });

  it.each([401, 500])(
    "propagates source errors (%s) rather than reporting a complete inspection",
    async (status) => {
      mswServer.use(
        http.get("*/detectors/789/", () =>
          HttpResponse.json({ detail: "Source failure" }, { status }),
        ),
      );
      await expect(getRule()).rejects.toThrow("Source failure");
    },
  );

  it("can inspect a workflow by name when the legacy metric API is retired", async () => {
    mswServer.use(
      http.get("*/combined-rules/", () =>
        HttpResponse.json({ detail: "Gone" }, { status: 410 }),
      ),
    );
    expect(
      getStructuredContent(
        await getRule({ kind: "all", ruleIdOrName: issueAlertRule.name }),
      ),
    ).toMatchObject({
      alertRule: { id: "123", name: issueAlertRule.name },
      warnings: [expect.stringContaining("retired")],
    });
  });
});
