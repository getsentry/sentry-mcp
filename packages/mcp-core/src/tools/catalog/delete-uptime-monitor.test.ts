import { mswServer } from "@sentry/mcp-server-mocks";
import { HttpResponse, http } from "msw";
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

  it("treats a second delete 404 as success", async () => {
    mswServer.use(
      http.delete(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/uptime/4509100000001001/",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

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
    expect(getStructuredContent(result)).toEqual({
      success: true,
      uptimeMonitorId: "4509100000001001",
      projectSlug: "cloudflare-mcp",
    });
  });

  it("claims idempotency", () => {
    expect(deleteUptimeMonitor.annotations.idempotentHint).toBe(true);
  });
});
