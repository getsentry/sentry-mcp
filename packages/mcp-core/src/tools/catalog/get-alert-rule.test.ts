import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
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
      "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/alert-rules/",
      () => HttpResponse.json([metricAlertRule]),
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

    expect(result).toMatchInlineSnapshot(`
      "# Alert Rule in **sentry-mcp-evals/cloudflare-mcp**

      ## Notify backend team

      **Kind**: Issue Alert
      **ID**: 123
      **Project**: cloudflare-mcp
      **Status**: enabled
      **Frequency**: 30 minutes
      **Environment**: production
      **Detector IDs**: 789
      **Owner**: team:backend
      **Created**: 2026-01-02T03:04:05.000Z
      **Updated**: 2026-01-02T04:04:05.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/monitors/alerts/123/
      ### Triggers

      - trigger-1 {"logicType":"any","conditions":[{"id":"condition-1","type":"event_frequency_count","comparison":10,"conditionResult":true}]}
      ### Action Filters

      - filter-1 {"logicType":"all","conditions":[],"actions":[{"id":"action-1","type":"email","config":{"targetType":"Team","targetIdentifier":"1"}}]}

      ## Response Notes

      - This tool is read-only. Treat the returned payload as the canonical source for any future clone or mutation workflow.
      "
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

    expect(result).toContain("# Alert Rule in **sentry-mcp-evals**");
    expect(result).toContain("**Kind**: Metric Alert");
    expect(result).toContain("**ID**: 456");
    expect(result).toContain("### Triggers");
  });

  it("falls back to organization metric alert details after a project ID miss", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/alert-rules/456/",
        () => HttpResponse.json({}, { status: 404 }),
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

  it("rejects organization metric alert fallback outside the active project constraint", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/alert-rules/456/",
        () => HttpResponse.json({}, { status: 404 }),
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
          kind: "metric",
          projectSlug: null,
          ruleIdOrName: "456",
        },
        projectConstrainedContext,
      ),
    ).rejects.toThrow('Metric alert rule is outside project "cloudflare-mcp"');
  });

  it("falls back to organization metric alert details after resolving an exact name", async () => {
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
        () => HttpResponse.json({}, { status: 404 }),
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

  it("handles native workflow issue alert payloads", async () => {
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

    expect(result).toContain("**Kind**: Issue Alert");
    expect(result).toContain("### Triggers");
    expect(result).toContain("### Action Filters");
    expect(result).not.toContain("**Action Match**");
    expect(result).not.toContain("**Filter Match**");
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
    expect(result).toContain("### Triggers");
    expect(result).toContain("event_frequency_count");
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
    expect(result).toContain("## Critical: backend");
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

    expect(result).toContain("## 123");
    expect(result).toContain("**ID**: 789");
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
        () => HttpResponse.json({}, { status: 404 }),
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
