import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";
import updateAlertRule from "./update-alert-rule.js";

const context = {
  constraints: { organizationSlug: null },
  accessToken: "access-token",
  userId: "1",
};

const params = {
  organizationSlug: "sentry-mcp-evals",
  regionUrl: null,
  projectSlug: null,
  ruleIdOrName: "123",
};

const endpoint =
  "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/123/";

const alertRule = {
  id: "123",
  name: "Notify backend team",
  enabled: false,
  config: { frequency: 30 },
  environment: "production",
  owner: "team:7",
  detectorIds: ["789"],
  triggers: {
    id: "10",
    logicType: "any" as const,
    conditions: [
      {
        id: "11",
        type: "event_frequency_count",
        comparison: { value: 10, interval: "1h" },
        conditionResult: true,
      },
    ],
  },
  actionFilters: [
    {
      id: "20",
      logicType: "all" as const,
      conditions: [],
      actions: [
        {
          id: "21",
          type: "slack",
          integrationId: "5",
          data: { tags: "environment" },
          config: {
            targetType: "specific",
            targetDisplay: "#old-channel",
            targetIdentifier: "COLD",
          },
        },
        {
          id: "22",
          type: "email",
          integrationId: null,
          data: {},
          config: {
            targetType: "team",
            targetDisplay: null,
            targetIdentifier: "7",
          },
        },
      ],
    },
    {
      id: "30",
      logicType: "all" as const,
      conditions: [],
      actions: [
        {
          id: "31",
          type: "slack",
          integrationId: "6",
          data: { tags: "release" },
          config: {
            targetType: "specific",
            targetDisplay: "#other-channel",
            targetIdentifier: "COTHER",
          },
        },
      ],
    },
  ],
};

function useAlertRuleHandlers() {
  const reads: string[] = [];
  const writes: Record<string, unknown>[] = [];
  mswServer.use(
    http.get(endpoint, ({ request }) => {
      reads.push(request.url);
      return HttpResponse.json(alertRule);
    }),
    http.put(endpoint, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      writes.push(body);
      return HttpResponse.json({ ...alertRule, ...body });
    }),
  );
  return { reads, writes };
}

function useProjectScope(projectIds: string[], includesAllProjects = false) {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
      () =>
        HttpResponse.json({
          id: "100",
          slug: "cloudflare-mcp",
          name: "Cloudflare MCP",
        }),
    ),
    http.get(`${endpoint}project-scope/`, () =>
      HttpResponse.json({ projectIds, includesAllProjects }),
    ),
  );
}

describe("update_alert_rule", () => {
  it("reports when Sentry saves a Slack destination without resolving its channel ID", async () => {
    const { writes } = useAlertRuleHandlers();
    const actionFilters = structuredClone(alertRule.actionFilters);
    actionFilters[0].actions[0].config.targetDisplay = "#new-channel";
    actionFilters[0].actions[0].config.targetIdentifier = "";

    await expect(
      updateAlertRule.handler({ ...params, actionFilters }, context),
    ).rejects.toThrow(
      "The alert was saved, but Sentry did not resolve a Slack destination.",
    );
    expect(writes[0]).toMatchObject({ enabled: false, actionFilters });
  });

  it("preserves a disabled alert and untouched configuration while clearing optional fields", async () => {
    const { writes } = useAlertRuleHandlers();

    const result = await updateAlertRule.handler(
      {
        ...params,
        frequencyMinutes: 0,
        environment: null,
        owner: null,
      },
      context,
    );

    expect(writes).toEqual([
      {
        name: alertRule.name,
        enabled: false,
        config: { frequency: 0 },
        environment: null,
        owner: null,
      },
    ]);
    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toMatchInlineSnapshot(`
      {
        "alertRule": {
          "actionFilters": [
            {
              "actions": [
                {
                  "config": {
                    "targetDisplay": "#old-channel",
                    "targetIdentifier": "COLD",
                    "targetType": "specific",
                  },
                  "data": {
                    "tags": "environment",
                  },
                  "id": "21",
                  "integrationId": "5",
                  "type": "slack",
                },
                {
                  "config": {
                    "targetDisplay": null,
                    "targetIdentifier": "7",
                    "targetType": "team",
                  },
                  "data": {},
                  "id": "22",
                  "integrationId": null,
                  "type": "email",
                },
              ],
              "conditions": [],
              "id": "20",
              "logicType": "all",
            },
            {
              "actions": [
                {
                  "config": {
                    "targetDisplay": "#other-channel",
                    "targetIdentifier": "COTHER",
                    "targetType": "specific",
                  },
                  "data": {
                    "tags": "release",
                  },
                  "id": "31",
                  "integrationId": "6",
                  "type": "slack",
                },
              ],
              "conditions": [],
              "id": "30",
              "logicType": "all",
            },
          ],
          "config": {
            "frequency": 0,
          },
          "enabled": false,
          "environment": null,
          "id": "123",
          "name": "Notify backend team",
          "owner": null,
          "triggers": {
            "conditions": [
              {
                "comparison": {
                  "interval": "1h",
                  "value": 10,
                },
                "conditionResult": true,
                "id": "11",
                "type": "event_frequency_count",
              },
            ],
            "id": "10",
            "logicType": "any",
          },
          "webUrl": "https://sentry-mcp-evals.sentry.io/monitors/alerts/123/",
        },
      }
    `);
  });

  it("repoints a Slack action without changing other actions or action groups", async () => {
    const { writes } = useAlertRuleHandlers();
    const actionFilters = structuredClone(alertRule.actionFilters);
    actionFilters[0].actions[0].config.targetDisplay = "#new-channel";

    const savedFilters = structuredClone(actionFilters);
    savedFilters[0].actions[0].config.targetIdentifier = "CNEW";
    mswServer.use(
      http.put(endpoint, async ({ request }) => {
        writes.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...alertRule, actionFilters: savedFilters });
      }),
    );
    const result = await updateAlertRule.handler(
      { ...params, actionFilters },
      context,
    );
    expect(getStructuredContent(result)).toMatchObject({
      alertRule: { actionFilters: savedFilters },
    });

    const expectedFilters = structuredClone(actionFilters);
    const { targetIdentifier: _staleId, ...updatedConfig } =
      expectedFilters[0].actions[0].config;
    expect(writes).toEqual([
      {
        name: alertRule.name,
        enabled: false,
        actionFilters: [
          {
            ...expectedFilters[0],
            actions: [
              { ...expectedFilters[0].actions[0], config: updatedConfig },
              alertRule.actionFilters[0].actions[1],
            ],
          },
          alertRule.actionFilters[1],
        ],
      },
    ]);
  });

  it("keeps an explicitly changed Slack channel ID", async () => {
    const { writes } = useAlertRuleHandlers();
    const actionFilters = structuredClone(alertRule.actionFilters);
    actionFilters[0].actions[0].config.targetDisplay = "#new-channel";
    actionFilters[0].actions[0].config.targetIdentifier = "CNEW";

    await updateAlertRule.handler({ ...params, actionFilters }, context);

    expect(writes).toEqual([
      { name: alertRule.name, enabled: false, actionFilters },
    ]);
  });

  it("replaces action filters when an explicit empty array is supplied", async () => {
    const { writes } = useAlertRuleHandlers();

    await updateAlertRule.handler({ ...params, actionFilters: [] }, context);

    expect(writes).toEqual([
      { name: alertRule.name, enabled: false, actionFilters: [] },
    ]);
  });

  it("resolves an exact alert name before reading authoritative detail", async () => {
    const { reads, writes } = useAlertRuleHandlers();
    useProjectScope(["100"]);
    const queries: URL[] = [];
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        ({ request }) => {
          queries.push(new URL(request.url));
          return HttpResponse.json([
            { id: "123", name: alertRule.name, detectorIds: ["789"] },
          ]);
        },
      ),
    );

    await updateAlertRule.handler(
      {
        ...params,
        projectSlug: "cloudflare-mcp",
        ruleIdOrName: alertRule.name,
        name: "Renamed alert",
      },
      context,
    );

    expect(queries[0].searchParams.get("projectSlug")).toBe("cloudflare-mcp");
    expect(reads).toHaveLength(1);
    expect(writes).toEqual([{ name: "Renamed alert", enabled: false }]);
  });

  it("rejects an empty update before reading or writing the API", async () => {
    const { reads, writes } = useAlertRuleHandlers();

    await expect(updateAlertRule.handler(params, context)).rejects.toThrow(
      "Provide at least one field to update",
    );

    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
  });

  it.each(["duplicate names", "remaining search pages"])(
    "rejects ambiguous name lookup with %s before reading detail or writing",
    async (reason) => {
      const { reads, writes } = useAlertRuleHandlers();
      const hasMore = reason === "remaining search pages";
      const rules = hasMore
        ? Array.from({ length: 100 }, (_, index) => ({
            ...alertRule,
            id: String(index + 123),
            name: index === 0 ? alertRule.name : `${alertRule.name} ${index}`,
          }))
        : [alertRule, { ...alertRule, id: "456" }];
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
          () =>
            HttpResponse.json(rules, {
              headers: hasMore
                ? {
                    Link: '<https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/?cursor=next-page>; rel="next"; results="true"; cursor="next-page"',
                  }
                : {},
            }),
        ),
      );

      await expect(
        updateAlertRule.handler(
          {
            ...params,
            projectSlug: "cloudflare-mcp",
            ruleIdOrName: alertRule.name,
            name: "Renamed alert",
          },
          context,
        ),
      ).rejects.toThrow("cannot be resolved unambiguously");

      expect(reads).toEqual([]);
      expect(writes).toEqual([]);
    },
  );

  it("allows a project-scoped update only when the workflow belongs wholly to that project", async () => {
    const { writes } = useAlertRuleHandlers();
    useProjectScope(["100"]);

    await updateAlertRule.handler(
      { ...params, projectSlug: "cloudflare-mcp", status: "active" },
      { ...context, constraints: { projectSlug: "cloudflare-mcp" } },
    );

    expect(writes).toEqual([{ name: alertRule.name, enabled: true }]);
  });

  it.each([
    { projectIds: ["100", "200"], includesAllProjects: false },
    { projectIds: ["100"], includesAllProjects: true },
    { projectIds: [], includesAllProjects: false },
  ])("rejects unsafe project scope %j before writing", async (scope) => {
    const { writes } = useAlertRuleHandlers();
    useProjectScope(scope.projectIds, scope.includesAllProjects);

    await expect(
      updateAlertRule.handler(
        { ...params, projectSlug: "cloudflare-mcp", status: "active" },
        { ...context, constraints: { projectSlug: "cloudflare-mcp" } },
      ),
    ).rejects.toThrow("outside the active project constraint");

    expect(writes).toEqual([]);
  });
});
