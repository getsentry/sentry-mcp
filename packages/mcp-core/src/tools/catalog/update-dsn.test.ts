import { describe, it, expect } from "vitest";
import updateDsn from "./update-dsn.js";
import { UserInputError } from "../../errors.js";

describe("update_dsn", () => {
  it("updates name and active status", async () => {
    const result = await updateDsn.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
        name: "New Key Name",
        isActive: false,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
          projectSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Updated DSN in **sentry-mcp-evals/cloudflare-mcp**

      **DSN ID**: d20df0a1ab5031c7f3c7edca9c02814d
      **DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945
      **Name**: New Key Name
      **Status**: Inactive
      **Rate Limit**: Disabled
      **Browser SDK Version**: 8.x
      **Loader Options**: Replay: Enabled, Performance: Enabled, Debug: Disabled

      ## Updates Applied
      - Updated name to "New Key Name"
      - Updated status to inactive

      ## Response Notes

      - Please tell the user the updated DSN settings.
      "
    `);
  });

  it("updates rate limit settings", async () => {
    const result = await updateDsn.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
        rateLimitWindow: 3600,
        rateLimitCount: 100,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
          projectSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain("**Rate Limit**: 100 events per 3600 seconds");
    expect(result).toContain("- Updated rate limit to 100 events per 3600s");
  });

  it("treats zero-valued rate limit updates as disabled", async () => {
    const result = await updateDsn.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
        rateLimitWindow: 3600,
        rateLimitCount: 0,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
          projectSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain("**Rate Limit**: Disabled");
    expect(result).toContain("- Updated rate limit disabled");
  });

  it("disables rate limit entirely", async () => {
    const result = await updateDsn.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
        disableRateLimit: true,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
          projectSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain("**Rate Limit**: Disabled");
    expect(result).toContain("- Updated rate limit disabled");
  });

  it("updates loader options", async () => {
    const result = await updateDsn.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
        loaderHasReplay: true,
        loaderHasPerformance: false,
        loaderHasDebug: true,
        loaderHasFeedback: true,
        loaderHasLogsAndMetrics: true,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
          projectSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain(
      "**Loader Options**: Replay: Enabled, Performance: Disabled, Debug: Enabled, Feedback: Enabled, Logs & Metrics: Enabled",
    );
    expect(result).toContain("- Updated loader options updated");
  });

  it("throws when no update fields are provided", async () => {
    await expect(
      updateDsn.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
          regionUrl: null,
        },
        {
          constraints: { organizationSlug: null, projectSlug: null },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("validates rate limit input combinations", async () => {
    const mockContext = {
      constraints: { organizationSlug: null, projectSlug: null },
      accessToken: "access-token",
      userId: "1",
    };

    await expect(
      updateDsn.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
          rateLimitWindow: 3600,
          regionUrl: null,
        },
        mockContext,
      ),
    ).rejects.toThrow(UserInputError);

    await expect(
      updateDsn.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
          rateLimitCount: 100,
          regionUrl: null,
        },
        mockContext,
      ),
    ).rejects.toThrow(UserInputError);

    await expect(
      updateDsn.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
          rateLimitWindow: 3600,
          rateLimitCount: 100,
          disableRateLimit: true,
          regionUrl: null,
        },
        mockContext,
      ),
    ).rejects.toThrow(UserInputError);
  });
});
