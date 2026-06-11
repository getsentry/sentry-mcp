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
  status: "active",
  actionMatch: "any",
  filterMatch: "all",
  frequency: 30,
  environment: "production",
  owner: "team:backend",
  dateCreated: "2026-01-02T03:04:05.000Z",
  conditions: [
    {
      id: "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition",
    },
  ],
  filters: [
    {
      id: "sentry.rules.filters.issue_occurrences.IssueOccurrencesFilter",
    },
  ],
  actions: [
    {
      id: "sentry.mail.actions.NotifyEmailAction",
      targetType: "Team",
      targetIdentifier: "1",
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
      "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/rules/",
      () => HttpResponse.json([issueAlertRule]),
    ),
    http.get(
      "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/rules/123/",
      () => HttpResponse.json(issueAlertRule),
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
      **Status**: active
      **Action Match**: any
      **Filter Match**: all
      **Frequency**: 30 minutes
      **Environment**: production
      **Owner**: team:backend
      **Created**: 2026-01-02T03:04:05.000Z
      **URL**: https://sentry-mcp-evals.sentry.io/issues/alerts/rules/cloudflare-mcp/123/details/
      ### Conditions

      - sentry.rules.conditions.first_seen_event.FirstSeenEventCondition
      ### Filters

      - sentry.rules.filters.issue_occurrences.IssueOccurrencesFilter
      ### Actions

      - sentry.mail.actions.NotifyEmailAction {"targetType":"Team","targetIdentifier":"1"}

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

  it("handles workflow-engine issue alerts with null match fields", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/rules/123/",
        () =>
          HttpResponse.json({
            ...issueAlertRule,
            actionMatch: null,
            filterMatch: null,
          }),
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

    expect(result).toContain("**Kind**: Issue Alert");
    expect(result).not.toContain("**Action Match**");
    expect(result).not.toContain("**Filter Match**");
  });

  it("fetches issue alert details after resolving an exact name", async () => {
    useAlertRuleHandlers();
    let detailRequestCount = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          return HttpResponse.json(
            params.get("alertType") === "rule"
              ? [
                  {
                    id: issueAlertRule.id,
                    name: issueAlertRule.name,
                  },
                ]
              : [],
          );
        },
      ),
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/rules/123/",
        () => {
          detailRequestCount += 1;
          return HttpResponse.json(issueAlertRule);
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

    expect(detailRequestCount).toBe(1);
    expect(result).toContain("### Conditions");
    expect(result).toContain(
      "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition",
    );
  });

  it("resolves digit-only issue alert names after a numeric ID miss", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
        () => HttpResponse.json(project),
      ),
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/rules/123/",
        () => HttpResponse.json({}, { status: 404 }),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          return HttpResponse.json(
            params.get("alertType") === "rule"
              ? [{ ...issueAlertRule, id: "789", name: "123" }]
              : [],
          );
        },
      ),
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/rules/789/",
        () => HttpResponse.json({ ...issueAlertRule, id: "789", name: "123" }),
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
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        ({ request }) => {
          const params = new URL(request.url).searchParams;
          return HttpResponse.json(
            params.get("alertType") === "rule"
              ? [{ ...issueAlertRule, name: "Same name" }]
              : [{ ...metricAlertRule, name: "Same name" }],
          );
        },
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
