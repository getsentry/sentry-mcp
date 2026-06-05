import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import findAlerts from "./find-alerts.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("find_alerts", () => {
  it("serializes alert workflows", async () => {
    const result = await findAlerts.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: null,
        query: null,
        detectorId: null,
        includeDetectors: true,
        limit: 10,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Alerts in **sentry-mcp-evals**

      ## Critical Errors to Slack

      **Alert ID**: 1001
      **Enabled**: yes
      **Created By**: 12345
      **Environment**: production
      **Connected Detectors**: 1
      **Action Filters**: 1
      **Created**: 2025-04-10T10:00:00.000Z
      **Updated**: 2025-04-14T10:00:00.000Z

      ## Connected Monitors And Detectors

      - Unhandled Errors (2001)
        - Type: error
        - Enabled: yes
        - Project: 4509062593708032
        - Owner: the-goats

      ## Response Notes

      - Use \`get_alert_details\` with an alert ID for full workflow details.
      - Detector IDs can be used to find workflows connected to a monitor.
      "
    `);
  });

  it("filters workflows and detectors by projectSlug instead of numeric project", async () => {
    const requestUrls: string[] = [];
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/",
        ({ request }) => {
          requestUrls.push(request.url);
          return HttpResponse.json([]);
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/detectors/",
        ({ request }) => {
          requestUrls.push(request.url);
          return HttpResponse.json([]);
        },
      ),
    );

    await findAlerts.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: "backend",
        query: null,
        detectorId: null,
        includeDetectors: true,
        limit: 10,
      },
      context,
    );

    expect(requestUrls).toHaveLength(2);
    for (const requestUrl of requestUrls) {
      const params = new URL(requestUrl).searchParams;
      expect(params.get("projectSlug")).toBe("backend");
      expect(params.get("project")).toBeNull();
    }
  });
});
