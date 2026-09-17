import { mswServer } from "@sentry/mcp-server-mocks";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { getStructuredContent } from "../../test-utils/structured-content.js";
import getAlertRule from "./get-alert-rule.js";
import {
  alertRuleSummarySchema,
  ParamAlertActionFilters,
  ParamAlertTriggers,
} from "./support/alert-rule-config";

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

function useAlertRuleHandlers(
  workflow: Record<string, unknown> = issueAlertRule,
) {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
      () => HttpResponse.json(project),
    ),
    http.get(
      "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
      () => HttpResponse.json([workflow]),
    ),
    http.get(
      "https://sentry.io/api/0/organizations/sentry-mcp-evals/alert-rules/456/",
      () => HttpResponse.json(metricAlertRule),
    ),
  );
}

describe("get_alert_rule", () => {
  it("gets an issue alert by numeric ID when kind is explicit", async () => {
    useAlertRuleHandlers();

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "123",
      },
      context,
    );

    expect(getStructuredContent(result)).toMatchInlineSnapshot(`
      {
        "alertRule": {
          "actionFilters": [
            {
              "actions": [
                {
                  "config": {
                    "targetIdentifier": "1",
                    "targetType": "Team",
                  },
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
          "enabled": true,
          "environment": "production",
          "id": "123",
          "name": "Notify backend team",
          "owner": "team:backend",
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
      }
    `);
  });

  it("gets a metric alert by numeric ID when kind is explicit", async () => {
    useAlertRuleHandlers();

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "metric",
        projectSlug: null,
        ruleIdOrName: "456",
      },
      context,
    );

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
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/alert-rules/456/",
        () => HttpResponse.json({}, { status: 500 }),
      ),
    );

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "metric",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "456",
      },
      context,
    );

    expect(result).toContain("**Kind**: Metric Alert");
    expect(result).toContain("**ID**: 456");
    expect(result).toContain("### Triggers");
  });

  it("rejects organization metric alert details outside the active project constraint", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/alert-rules/456/",
        () =>
          HttpResponse.json({
            ...metricAlertRule,
            projects: ["frontend"],
          }),
      ),
    );

    await expect(
      getAlertRule.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          kind: "metric",
          projectSlug: null,
          ruleIdOrName: "456",
        },
        projectConstrainedContext,
      ),
    ).rejects.toThrow('Metric alert rule is outside project "cloudflare-mcp"');
  });

  it("uses organization metric alert details after resolving an exact name", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          return HttpResponse.json(
            params.get("alertType") === "alert_rule"
              ? [
                  {
                    id: metricAlertRule.id,
                    name: metricAlertRule.name,
                  },
                ]
              : [],
          );
        },
      ),
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/alert-rules/456/",
        () => HttpResponse.json({}, { status: 500 }),
      ),
    );

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "metric",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "P95 latency",
      },
      context,
    );

    expect(result).toContain("**Kind**: Metric Alert");
    expect(result).toContain("**ID**: 456");
    expect(result).toContain("### Triggers");
  });

  it("returns complete editable groups and actions without backend-only fields", async () => {
    const actions = Array.from({ length: 7 }, (_, index) => ({
      id: String(100 + index),
      type: "slack",
      integrationId: "42",
      config: {
        targetType: "specific",
        targetDisplay: `#alerts-${index}`,
        targetIdentifier: `C00000000${index}`,
      },
      data: { tags: "environment,release", notes: "Investigate new failures" },
      status: "active",
    }));
    const actionFilters = [
      {
        id: "200",
        logicType: "none",
        conditions: [
          {
            id: "201",
            type: "tagged_event",
            comparison: { key: "environment", value: "test", match: "eq" },
            conditionResult: true,
          },
        ],
        actions,
      },
      { id: "300", logicType: "all", conditions: [], actions: [] },
    ];
    useAlertRuleHandlers({
      ...issueAlertRule,
      enabled: false,
      owner: null,
      actionMatch: "all",
      filterMatch: "all",
      config: { ...issueAlertRule.config, internalOnly: "not-public" },
      internalOnly: "not-public",
      triggers: { ...issueAlertRule.triggers, organizationId: "not-public" },
      actionFilters: actionFilters.map((group) => ({
        ...group,
        organizationId: "not-public",
        actions: group.actions.map((action) => ({
          ...action,
          internalOnly: "not-public",
        })),
      })),
    });

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "123",
      },
      context,
    );

    const summary = alertRuleSummarySchema.parse(
      getStructuredContent(result).alertRule,
    );
    expect(summary.enabled).toBe(false);
    expect(summary.owner).toBeNull();
    expect(summary.config).toEqual(issueAlertRule.config);
    expect(summary.actionFilters).toEqual(actionFilters);
    expect(ParamAlertActionFilters.parse(summary.actionFilters)).toEqual(
      actionFilters,
    );
    expect(ParamAlertTriggers.parse(summary.triggers)).toEqual(
      issueAlertRule.triggers,
    );
    expect(JSON.stringify(result)).not.toContain("not-public");
    expect(JSON.stringify(result)).not.toContain("detectorIds");
    expect(JSON.stringify(result)).not.toContain("actionMatch");
    expect(JSON.stringify(result)).not.toContain("filterMatch");
  });

  it("fetches issue alert details after resolving an exact name", async () => {
    useAlertRuleHandlers();
    let detailRequestCount = 0;
    let listRequestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          if (params.get("id") === "123") {
            detailRequestCount += 1;
            return HttpResponse.json([issueAlertRule]);
          }
          listRequestUrl = request.url;
          return HttpResponse.json([
            {
              id: issueAlertRule.id,
              name: issueAlertRule.name,
              detectorIds: issueAlertRule.detectorIds,
            },
          ]);
        },
      ),
    );

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "Notify backend team",
      },
      context,
    );

    expect(listRequestUrl).not.toBeNull();
    const listParams = new URL(listRequestUrl ?? "").searchParams;
    expect(listParams.get("query")).toBe('name:"*Notify backend team*"');
    expect(listParams.get("projectSlug")).toBe("cloudflare-mcp");
    expect(detailRequestCount).toBe(1);
    expect(result).toMatchObject({
      structuredContent: { alertRule: { triggers: issueAlertRule.triggers } },
    });
  });

  it("quotes issue alert name lookups for workflow query syntax", async () => {
    useAlertRuleHandlers();
    let listRequestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          if (params.get("id") === "123") {
            return HttpResponse.json([
              { ...issueAlertRule, name: "Critical: backend" },
            ]);
          }
          listRequestUrl = request.url;
          return HttpResponse.json([
            { ...issueAlertRule, name: "Critical: backend" },
          ]);
        },
      ),
    );

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "Critical: backend",
      },
      context,
    );

    expect(listRequestUrl).not.toBeNull();
    expect(new URL(listRequestUrl ?? "").searchParams.get("query")).toBe(
      'name:"*Critical: backend*"',
    );
    expect(result).toMatchObject({
      structuredContent: { alertRule: { name: "Critical: backend" } },
    });
  });

  it("ignores unattached organization workflows during issue detail lookup", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        () =>
          HttpResponse.json([
            {
              ...issueAlertRule,
              detectorIds: [],
            },
          ]),
      ),
    );

    await expect(
      getAlertRule.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          kind: "issue",
          projectSlug: "cloudflare-mcp",
          ruleIdOrName: "123",
        },
        context,
      ),
    ).rejects.toThrow('Issue alert rule "123" was not found');
  });

  it("resolves digit-only issue alert names after a numeric ID miss", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          if (params.get("id") === "123") {
            return HttpResponse.json([]);
          }
          if (
            params.get("id") === "789" ||
            params.get("query") === 'name:"*123*"'
          ) {
            return HttpResponse.json([
              { ...issueAlertRule, id: "789", name: "123" },
            ]);
          }
          return HttpResponse.json([]);
        },
      ),
    );

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "issue",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "123",
      },
      context,
    );

    expect(result).toMatchObject({
      structuredContent: { alertRule: { name: "123", id: "789" } },
    });
  });

  it("treats digit-only values as exact names with kind all", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
        () => HttpResponse.json(project),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        () => HttpResponse.json([]),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          return HttpResponse.json(
            params.get("alertType") === "alert_rule"
              ? [{ ...metricAlertRule, id: "789", name: "123" }]
              : [],
          );
        },
      ),
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/alert-rules/789/",
        () => HttpResponse.json({}, { status: 500 }),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/alert-rules/789/",
        () => HttpResponse.json({ ...metricAlertRule, id: "789", name: "123" }),
      ),
    );

    const result = await getAlertRule.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        kind: "all",
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: "123",
      },
      context,
    );

    expect(result).toContain("## 123");
    expect(result).toContain("**Kind**: Metric Alert");
    expect(result).toContain("**ID**: 789");
  });

  it("rejects exact-name metric matches outside the active project constraint", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
        () => HttpResponse.json(project),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        () => HttpResponse.json([]),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        () => HttpResponse.json([metricAlertRule]),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/alert-rules/456/",
        () =>
          HttpResponse.json({
            ...metricAlertRule,
            projects: ["frontend"],
          }),
      ),
    );

    await expect(
      getAlertRule.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          kind: "all",
          projectSlug: null,
          ruleIdOrName: "P95 latency",
        },
        projectConstrainedContext,
      ),
    ).rejects.toThrow('Metric alert rule is outside project "cloudflare-mcp"');
  });

  it("rejects ambiguous exact-name lookups", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
        () => HttpResponse.json(project),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        () => HttpResponse.json([{ ...issueAlertRule, name: "Same name" }]),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        () => HttpResponse.json([{ ...metricAlertRule, name: "Same name" }]),
      ),
    );

    await expect(
      getAlertRule.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          kind: "all",
          projectSlug: "cloudflare-mcp",
          ruleIdOrName: "Same name",
        },
        context,
      ),
    ).rejects.toThrow('Multiple alert rules named "Same name" were found');
  });
});
