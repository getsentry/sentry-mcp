import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import findAlertRules from "./find-alert-rules.js";

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
      "https://sentry.io/api/0/organizations/sentry-mcp-evals/alert-rules/",
      () => HttpResponse.json([metricAlertRule]),
    ),
    http.get(
      "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/alert-rules/",
      () => HttpResponse.json([metricAlertRule]),
    ),
  );
}

describe("find_alert_rules", () => {
  it("serializes project-scoped issue and metric alert rules", async () => {
    useAlertRuleHandlers();
    let metricRequestUrl: string | null = null;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/alert-rules/",
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

    expect(metricRequestUrl).not.toBeNull();
    expect(result).toMatchInlineSnapshot(`
      "# Alert Rules in **sentry-mcp-evals/cloudflare-mcp**

      ## Issue Alert Rules

      ### Notify backend team

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

      ## Metric Alert Rules

      ### P95 latency

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

      ## Response Notes

      - Use \`get_alert_rule\` with \`kind\` and the numeric rule ID for full details.
      - Alert rule actions can include integration-specific payloads; inspect existing rules before planning mutations.
      "
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

    expect(result).toContain("## Metric Alert Rules");
    expect(result).not.toContain("## Issue Alert Rules");
    expect(result).toContain(
      "Issue alert rules are project-scoped; pass `projectSlug` to include them.",
    );
  });

  it("returns next cursors for direct alert rule list endpoints", async () => {
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/rules/",
        () =>
          HttpResponse.json([issueAlertRule], {
            headers: {
              Link: '<https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/rules/?cursor=issue-page-2>; rel="next"; results="true"; cursor="issue-page-2"',
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

    expect(result).toContain(
      'More issue alert rules are available. Pass `kind: "issue"` and `cursor: "issue-page-2"`',
    );
  });

  it("uses the supported combined-rules name filter for query searches", async () => {
    const requestUrls: string[] = [];
    useAlertRuleHandlers();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/combined-rules/",
        ({ request }) => {
          requestUrls.push(request.url);
          const params = new URL(request.url).searchParams;
          return HttpResponse.json(
            params.get("alertType") === "rule"
              ? [issueAlertRule]
              : [metricAlertRule],
          );
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

    expect(result).toContain("Notify backend team");
    expect(result).toContain("P95 latency");
    expect(requestUrls).toHaveLength(2);
    for (const requestUrl of requestUrls) {
      const params = new URL(requestUrl).searchParams;
      expect(params.get("name")).toBe("backend");
      expect(params.get("query")).toBeNull();
      expect(params.get("project")).toBe(project.id);
    }
    expect(
      requestUrls
        .map((url) => new URL(url).searchParams.get("alertType"))
        .sort(),
    ).toMatchInlineSnapshot(`
        [
          "alert_rule",
          "rule",
        ]
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

    expect(result).toContain("P95 latency");
    expect(result).toContain(
      'More metric alert rules are available. Pass `kind: "metric"` and `cursor: "metric-query-page-2"`',
    );
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
