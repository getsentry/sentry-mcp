import { describe, expect, it } from "vitest";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";
import updateUptimeMonitor, {
  updateUptimeMonitorOutputSchema,
} from "./update-uptime-monitor.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("update_uptime_monitor", () => {
  it("updates monitor status", async () => {
    const result = await updateUptimeMonitor.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: "cloudflare-mcp",
        uptimeMonitorId: "4509100000001001",
        name: null,
        url: null,
        intervalSeconds: null,
        timeoutMs: null,
        method: null,
        headers: null,
        body: null,
        assertion: null,
        status: "disabled",
        owner: null,
        environment: null,
        traceSampling: null,
        responseCaptureEnabled: null,
        recoveryThreshold: null,
        downtimeThreshold: null,
      },
      context,
    );

    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(updateUptimeMonitorOutputSchema.parse(structuredContent)).toEqual(
      structuredContent,
    );
    expect(
      (structuredContent as { monitor: { status: string } }).monitor.status,
    ).toBe("disabled");
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "monitor": {
          "downtimeThreshold": 3,
          "environment": "production",
          "id": "4509100000001001",
          "intervalSeconds": 60,
          "method": "GET",
          "name": "API Health",
          "owner": "the-goats",
          "projectSlug": "cloudflare-mcp",
          "recoveryThreshold": 1,
          "responseCaptureEnabled": true,
          "status": "disabled",
          "timeoutMs": 5000,
          "traceSampling": false,
          "uptimeStatus": 1,
          "url": "https://example.com/health",
          "webUrl": "https://sentry-mcp-evals.sentry.io/monitors/4509100000001001/",
        },
      }
    `);
  });
});
