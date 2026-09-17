import { mswServer } from "@sentry/mcp-server-mocks";
import { HttpResponse, http } from "msw";
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

const slackAction = {
  id: "21",
  type: "slack",
  integrationId: "5",
  data: { tags: "environment" },
  config: {
    targetType: "specific",
    targetDisplay: "#old-channel",
    targetIdentifier: "COLD",
  },
};
const alertRule = {
  id: "123",
  name: "Notify backend team",
  enabled: false,
  config: { frequency: 30 },
  environment: "production",
  owner: "team:7",
  triggers: null,
  detectorIds: ["789"],
  actionFilters: [
    {
      id: "20",
      logicType: "all" as const,
      conditions: [],
      actions: [slackAction],
    },
  ],
};

function useAlertRuleHandlers(workflow: Record<string, unknown> = alertRule) {
  const reads: string[] = [];
  const writes: Record<string, unknown>[] = [];
  mswServer.use(
    http.get(endpoint, ({ request }) => {
      reads.push(request.url);
      return HttpResponse.json(workflow);
    }),
    http.put(endpoint, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      writes.push(body);
      return HttpResponse.json({ ...workflow, ...body });
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
              ],
              "conditions": [],
              "id": "20",
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
          "triggers": null,
          "webUrl": "https://sentry-mcp-evals.sentry.io/monitors/alerts/123/",
        },
      }
    `);
  });

  it.each([
    { source: "copied", inputId: "COLD", expectedId: undefined },
    { source: "explicit", inputId: "CNEW", expectedId: "CNEW" },
    {
      source: "changed workspace",
      inputId: "COLD",
      expectedId: undefined,
      integrationId: "6",
      targetDisplay: "#old-channel",
    },
  ])(
    "handles a $source Slack channel ID while preserving other actions and groups",
    async ({
      inputId,
      expectedId,
      integrationId = "5",
      targetDisplay = "#new-channel",
    }) => {
      const { writes } = useAlertRuleHandlers();
      const actionFilters: Parameters<
        typeof updateAlertRule.handler
      >[0]["actionFilters"] = structuredClone(alertRule.actionFilters);
      actionFilters[0].actions.push({
        id: "22",
        type: "email",
        integrationId: null,
        data: {},
        config: {
          targetType: "team",
          targetDisplay: null,
          targetIdentifier: "7",
        },
      });
      actionFilters.push({
        ...actionFilters[0],
        id: "30",
        actions: [{ ...slackAction, id: "31" }],
      });
      actionFilters[0].actions[0].config = {
        ...slackAction.config,
        targetDisplay,
        targetIdentifier: inputId,
      };
      actionFilters[0].actions[0].integrationId = integrationId;
      const savedFilters = structuredClone(actionFilters);
      savedFilters[0].actions[0].config.targetIdentifier = "CNEW";
      mswServer.use(
        http.put(endpoint, async ({ request }) => {
          writes.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json({
            ...alertRule,
            actionFilters: savedFilters,
          });
        }),
      );

      const result = await updateAlertRule.handler(
        { ...params, actionFilters },
        context,
      );
      const expectedFilters = structuredClone(actionFilters);
      const expectedConfig: Record<string, unknown> =
        expectedFilters[0].actions[0].config;
      if (expectedId === undefined) delete expectedConfig.targetIdentifier;
      else expectedConfig.targetIdentifier = expectedId;
      expect(writes).toEqual([
        {
          name: alertRule.name,
          enabled: false,
          actionFilters: expectedFilters,
        },
      ]);
      expect(getStructuredContent(result)).toMatchObject({
        alertRule: { actionFilters: savedFilters },
      });
    },
  );

  it.each([
    ["msteams", "specific", "19:old@thread.tacv2", {}, "5"],
    ["discord", "specific", "1234567890", { tags: "environment" }, "5"],
    ["pagerduty", "specific", "42", { priority: "critical" }, "5"],
    ["opsgenie", "specific", "42", { priority: "P1" }, "5"],
    ["email", "team", "7", {}, null],
    ["webhook", null, "notification-app", {}, null],
    [
      "sentry_app",
      "sentry_app",
      "42",
      { settings: [{ name: "channel", value: "Incidents" }] },
      null,
    ],
  ] as const)(
    "edits %s notification settings using its native action contract",
    async (type, targetType, targetIdentifier, data, integrationId) => {
      const action = {
        id: "21",
        type,
        integrationId,
        data,
        config: {
          ...(targetType ? { targetType } : {}),
          targetIdentifier,
          ...(type === "msteams" ? { targetDisplay: "Incidents" } : {}),
        },
      };
      const currentAction = {
        ...action,
        config: {
          ...action.config,
          ...(type === "msteams"
            ? { targetDisplay: "Previous" }
            : { targetIdentifier: "1" }),
        },
      };
      const group = { ...alertRule.actionFilters[0], actions: [currentAction] };
      const { writes } = useAlertRuleHandlers({
        ...alertRule,
        actionFilters: [group],
      });
      const actionFilters = [{ ...group, actions: [action] }];
      // Teams always resolves the supplied name, replacing even an old channel ID.
      const savedAction =
        type === "msteams"
          ? {
              ...action,
              config: {
                ...action.config,
                targetIdentifier: "19:new@thread.tacv2",
              },
            }
          : action;
      mswServer.use(
        http.put(endpoint, async ({ request }) => {
          writes.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json({
            ...alertRule,
            actionFilters: [{ ...group, actions: [savedAction] }],
          });
        }),
      );

      const result = await updateAlertRule.handler(
        { ...params, actionFilters },
        context,
      );
      expect(writes).toEqual([
        { name: alertRule.name, enabled: false, actionFilters },
      ]);
      expect(getStructuredContent(result)).toMatchObject({
        alertRule: { actionFilters: [{ ...group, actions: [savedAction] }] },
      });
    },
  );

  it("replaces action filters when an explicit empty array is supplied", async () => {
    const { writes } = useAlertRuleHandlers();

    await updateAlertRule.handler({ ...params, actionFilters: [] }, context);

    expect(writes).toEqual([
      { name: alertRule.name, enabled: false, actionFilters: [] },
    ]);
  });

  it("resolves an exact name and permits an update within the constrained project", async () => {
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
        status: "active",
      },
      { ...context, constraints: { projectSlug: "cloudflare-mcp" } },
    );

    expect(queries[0].searchParams.get("projectSlug")).toBe("cloudflare-mcp");
    expect(reads).toHaveLength(1);
    expect(writes).toEqual([{ name: "Renamed alert", enabled: true }]);
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
