import { mswServer } from "@sentry/mcp-server-mocks";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import getUptimeMonitorDetails from "./get-uptime-monitor-details.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("get_uptime_monitor_details", () => {
  it("serializes uptime monitor details without leaking secrets", async () => {
    const result = await getUptimeMonitorDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: "cloudflare-mcp",
        uptimeMonitorId: "4509100000001001",
        period: "24h",
        start: null,
        end: null,
        checkLimit: 10,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Uptime Monitor API Health in **sentry-mcp-evals**

      **ID**: 4509100000001001
      **Project**: cloudflare-mcp
      **Status**: active
      **Uptime Status**: ok
      **URL**: https://example.com/health
      **Method**: GET
      **Interval**: 60s
      **Timeout**: 5000ms
      **Environment**: production
      **Owner**: the-goats
      **Recovery Threshold**: 1
      **Downtime Threshold**: 3
      **Trace Sampling**: false
      **Response Capture**: true
      **Web URL**: [Open Monitor](https://sentry-mcp-evals.sentry.io/monitors/4509100000001001/)

      ## Headers

      - Accept: application/json
      - Authorization: [REDACTED]

      _Sensitive header values are redacted. Request body is omitted from this view._

      ## Recent Checks

      - 2025-04-14T02:00:13.000Z: success, HTTP 200, 142ms, US East, production
      - 2025-04-14T01:59:13.000Z: failure_incident (timeout), 5000ms, US East, production

      ## Response Notes

      - Search related issues with \`search_issues\` query \`uptime_rule:4509100000001001\`.
      - Request body is never included in this response. Sensitive header values are redacted.
      "
    `);
    expect(String(result)).not.toContain("secret-token");
    expect(String(result)).not.toContain("should-not-appear");
  });

  it("skips malformed short header arrays", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/uptime/4509100000001001/",
        () =>
          HttpResponse.json({
            id: "4509100000001001",
            projectSlug: "cloudflare-mcp",
            environment: null,
            name: "API Health",
            status: "active",
            uptimeStatus: 1,
            url: "https://example.com/health",
            method: "GET",
            body: null,
            headers: [["Authorization"], ["X-Custom", "ok"]],
            intervalSeconds: 60,
            timeoutMs: 5000,
          }),
      ),
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/uptime/4509100000001001/checks/",
        () => HttpResponse.json([]),
      ),
    );

    const result = await getUptimeMonitorDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: "cloudflare-mcp",
        uptimeMonitorId: "4509100000001001",
        period: "24h",
        start: null,
        end: null,
        checkLimit: 10,
      },
      context,
    );

    expect(String(result)).toContain("- X-Custom: ok");
    expect(String(result)).not.toContain("undefined");
  });
});
