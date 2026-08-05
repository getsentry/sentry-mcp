import { describe, expect, it } from "vitest";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";
import deleteUptimeMonitor, {
  deleteUptimeMonitorOutputSchema,
} from "./delete-uptime-monitor.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("delete_uptime_monitor", () => {
  it("deletes an uptime monitor", async () => {
    const result = await deleteUptimeMonitor.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        projectSlug: "cloudflare-mcp",
        uptimeMonitorId: "4509100000001001",
      },
      context,
    );

    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(deleteUptimeMonitorOutputSchema.parse(structuredContent)).toEqual(
      structuredContent,
    );
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "projectSlug": "cloudflare-mcp",
        "success": true,
        "uptimeMonitorId": "4509100000001001",
      }
    `);
  });
});
