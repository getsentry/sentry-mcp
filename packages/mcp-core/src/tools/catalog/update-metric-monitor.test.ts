import { mswServer } from "@sentry/mcp-server-mocks";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { UserInputError } from "../../errors";
import { createTestContext } from "../../test-utils/context";
import { metricMonitor } from "../../test-utils/metric-monitor";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content";
import { executeToolHandler } from "../catalog-runtime/availability";
import updateMetricMonitor from "./update-metric-monitor";

const endpoint =
  "https://sentry.io/api/0/organizations/test-org/detectors/123/";
const conditions = [
  { type: "gt", comparison: 110, conditionResult: 75 },
  { type: "lte", comparison: 105, conditionResult: 0 },
];
const anomaly = {
  type: "anomaly_detection",
  comparison: { sensitivity: "high", seasonality: "auto", thresholdType: 2 },
  conditionResult: 75,
};

function update(changes: Record<string, unknown>) {
  return executeToolHandler({
    tool: updateMetricMonitor,
    params: { organizationSlug: "test-org", monitorId: "123", ...changes },
    context: createTestContext(),
  });
}

function useMonitor(overrides: Record<string, unknown> = {}) {
  const monitor = { ...metricMonitor, ...overrides };
  const writes: Record<string, unknown>[] = [];
  mswServer.use(
    http.get(endpoint, () => HttpResponse.json(monitor)),
    http.put(endpoint, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      writes.push(body);
      return HttpResponse.json({
        ...monitor,
        ...body,
        dataSources: monitor.dataSources,
      });
    }),
  );
  return writes;
}

describe("update_metric_monitor", () => {
  it.each(["static", "percent", "dynamic"])(
    "preserves %s detection when editing metadata and disconnecting Alerts",
    async (detectionType) => {
      const writes = useMonitor({
        config: {
          detectionType,
          comparisonDelta: detectionType === "percent" ? 3600 : null,
        },
        conditionGroup: {
          logicType: "any",
          conditions: detectionType === "dynamic" ? [anomaly] : conditions,
        },
      });
      await update({
        name: "Renamed",
        status: "active",
        owner: null,
        description: null,
        workflowIds: [],
      });
      expect(writes).toEqual([
        {
          name: "Renamed",
          enabled: true,
          owner: null,
          description: null,
          workflowIds: [],
        },
      ]);
    },
  );

  it("returns the saved monitor after disabling it", async () => {
    const writes = useMonitor({ enabled: true });
    const result = await update({ status: "disabled" });
    expect(writes).toEqual([{ enabled: false }]);
    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toMatchInlineSnapshot(`
      {
        "monitor": {
          "conditionGroup": {
            "conditions": [
              {
                "comparison": 100,
                "conditionResult": 75,
                "id": "11",
                "type": "gt",
              },
              {
                "comparison": 50,
                "conditionResult": 0,
                "id": "12",
                "type": "lte",
              },
            ],
            "id": "10",
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
                "environment": "production",
                "eventTypes": [
                  "error",
                ],
                "extrapolationMode": null,
                "query": "level:error",
                "timeWindowSeconds": 300,
              },
              "type": "snuba_query_subscription",
            },
          ],
          "dateCreated": "2026-01-01T00:00:00.000Z",
          "dateUpdated": "2026-01-02T00:00:00.000Z",
          "description": "Monitor production errors",
          "enabled": false,
          "id": "123",
          "name": "High error rate",
          "owner": "Backend",
          "projectId": "100",
          "webUrl": "https://test-org.sentry.io/monitors/123/",
          "workflowIds": [
            "456",
          ],
        },
      }
    `);
  });

  it("merges query and percent settings without changing native thresholds or leaking source IDs", async () => {
    const writes = useMonitor({
      config: { detectionType: "percent", comparisonDelta: 3600 },
    });
    const conditionGroup = {
      id: "10",
      logicType: "any",
      conditions: conditions.map((condition, i) => ({
        ...condition,
        id: String(i + 11),
      })),
    };
    await update({
      query: {
        query: "level:fatal",
        timeWindowSeconds: 900,
        environment: null,
      },
      config: { comparisonDeltaSeconds: 86400 },
      conditionGroup,
    });
    expect(writes).toEqual([
      {
        dataSources: [
          {
            dataset: "events",
            query: "level:fatal",
            aggregate: "count()",
            timeWindow: 900,
            environment: null,
            eventTypes: ["error"],
            extrapolationMode: null,
          },
        ],
        config: { detectionType: "percent", comparisonDelta: 86400 },
        conditionGroup,
      },
    ]);
  });

  it.each([
    [
      "events_analytics_platform",
      ["trace_item_span"],
      "count(span.duration)",
      "server_weighted",
    ],
    ["events_analytics_platform", ["trace_item_log"], "count()", null],
    [
      "events_analytics_platform",
      ["trace_item_metric"],
      "sum(value,requests,counter,none)",
      "client_and_server_weighted",
    ],
    [
      "metrics",
      [],
      "percentage(sessions_crashed, sessions) AS _crash_rate_alert_aggregate",
      null,
    ],
    ["generic_metrics", ["transaction"], "p95(transaction.duration)", null],
  ])(
    "preserves %s / %j source settings across metadata and query edits",
    async (dataset, eventTypes, aggregate, extrapolationMode) => {
      const query = {
        dataset,
        eventTypes,
        aggregate,
        extrapolationMode,
        timeWindow: 3600,
        query: "",
        environment: null,
      };
      const source = metricMonitor.dataSources[0];
      const writes = useMonitor({
        dataSources: [
          {
            ...source,
            queryObj: {
              ...source.queryObj,
              snubaQuery: {
                ...source.queryObj.snubaQuery,
                ...query,
                query: "release:previous",
                environment: "production",
              },
            },
          },
        ],
      });
      await update({ name: "Renamed" });
      await update({
        query: { query: "", timeWindowSeconds: 3600, environment: null },
      });
      expect(writes).toEqual([{ name: "Renamed" }, { dataSources: [query] }]);
    },
  );

  it.each([
    ["static", "dynamic"],
    ["dynamic", "dynamic"],
    ["percent", "static"],
  ])(
    "updates %s to %s with consistent config and conditions",
    async (previousMode, detectionType) => {
      const writes = useMonitor({
        config: {
          detectionType: previousMode,
          comparisonDelta: previousMode === "percent" ? 3600 : null,
        },
      });
      const conditionGroup = {
        logicType: "any",
        conditions: detectionType === "dynamic" ? [anomaly] : conditions,
      };
      await update({
        conditionGroup,
        ...(previousMode !== detectionType
          ? { config: { detectionType } }
          : {}),
      });
      expect(writes).toEqual([
        {
          config: { detectionType, comparisonDelta: null },
          conditionGroup,
        },
      ]);
    },
  );

  it.each([
    [{}, {}],
    [{}, { config: { comparisonDeltaSeconds: 3600 } }],
    [
      {},
      {
        config: { detectionType: "percent" },
        conditionGroup: { logicType: "any", conditions },
      },
    ],
    [
      {},
      {
        config: { detectionType: "dynamic" },
        conditionGroup: { logicType: "any", conditions: [anomaly, anomaly] },
      },
    ],
    [
      {},
      {
        config: { detectionType: "dynamic" },
        conditionGroup: {
          logicType: "any",
          conditions: [{ ...anomaly, comparison: 100 }],
        },
      },
    ],
    [{}, { config: { detectionType: "dynamic" } }],
    [
      {},
      {
        config: { detectionType: "dynamic" },
        conditionGroup: { logicType: "any", conditions },
      },
    ],
    [{}, { conditionGroup: { logicType: "any", conditions: [anomaly] } }],
    [{ dataSources: [] }, { query: { aggregate: "count_unique(user)" } }],
  ])(
    "rejects incomplete or incompatible edits before writing: %j %j",
    async (monitor, changes) => {
      const writes = useMonitor(monitor);
      await expect(update(changes)).rejects.toThrow(UserInputError);
      expect(writes).toEqual([]);
    },
  );
});
