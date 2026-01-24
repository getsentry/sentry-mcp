import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import {
  mswServer,
  traceMetaFixture,
  traceFixture,
} from "@sentry/mcp-server-mocks";
import getSentryResource from "./get-sentry-resource.js";

const baseContext = {
  constraints: {
    organizationSlug: undefined,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("get_sentry_resource", () => {
  describe("URL mode (auto-detect)", () => {
    it("fetches issue from issue URL", async () => {
      const result = await getSentryResource.handler(
        {
          url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41",
          resourceType: undefined,
          organizationSlug: undefined,
          issueId: undefined,
          eventId: undefined,
          traceId: undefined,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "Error: Tool list_organizations is already registered",
      );
    });

    it("fetches event from event URL", async () => {
      const result = await getSentryResource.handler(
        {
          url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51",
          resourceType: undefined,
          organizationSlug: undefined,
          issueId: undefined,
          eventId: undefined,
          traceId: undefined,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
    });

    it("fetches trace from trace URL", async () => {
      const traceId = "a4d1aae7216b47ff8117cf4e09ce9d0a";

      mswServer.use(
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace-meta/${traceId}/`,
          () => HttpResponse.json(traceMetaFixture),
          { once: true },
        ),
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace/${traceId}/`,
          () => HttpResponse.json(traceFixture),
          { once: true },
        ),
      );

      const result = await getSentryResource.handler(
        {
          url: `https://test-org.sentry.io/explore/traces/trace/${traceId}`,
          resourceType: undefined,
          organizationSlug: undefined,
          issueId: undefined,
          eventId: undefined,
          traceId: undefined,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
      expect(result).toContain("**Total Spans**: 112");
    });

    it("throws error for unsupported URL", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: "https://sentry-mcp-evals.sentry.io/settings/projects/",
            resourceType: undefined,
            organizationSlug: undefined,
            issueId: undefined,
            eventId: undefined,
            traceId: undefined,
            projectSlug: undefined,
            profilerId: undefined,
            transactionName: undefined,
            regionUrl: null,
          },
          baseContext,
        ),
      ).rejects.toThrow("Could not determine resource type from URL");
    });

    it("returns helpful message for replay URL", async () => {
      const result = await getSentryResource.handler(
        {
          url: "https://my-org.sentry.io/replays/abc123def456/",
          resourceType: undefined,
          organizationSlug: undefined,
          issueId: undefined,
          eventId: undefined,
          traceId: undefined,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain("# Replay Detected");
      expect(result).toContain("**Organization**: my-org");
      expect(result).toContain("**Replay ID**: abc123def456");
      expect(result).toContain("Session replay support is coming soon");
      expect(result).toContain("Open Replay");
    });

    it("returns helpful message for monitor URL", async () => {
      const result = await getSentryResource.handler(
        {
          url: "https://my-org.sentry.io/crons/daily-backup/",
          resourceType: undefined,
          organizationSlug: undefined,
          issueId: undefined,
          eventId: undefined,
          traceId: undefined,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain("# Cron Monitor Detected");
      expect(result).toContain("**Organization**: my-org");
      expect(result).toContain("**Monitor**: daily-backup");
      expect(result).toContain("Cron monitor support is coming soon");
      expect(result).toContain("Open Monitor");
    });

    it("returns helpful message for release URL", async () => {
      const result = await getSentryResource.handler(
        {
          url: "https://my-org.sentry.io/releases/v1.2.3/",
          resourceType: undefined,
          organizationSlug: undefined,
          issueId: undefined,
          eventId: undefined,
          traceId: undefined,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain("# Release Detected");
      expect(result).toContain("**Organization**: my-org");
      expect(result).toContain("**Release**: v1.2.3");
      expect(result).toContain("find_releases");
      expect(result).toContain("Open Release");
    });

    it("provides helpful error for performance summary URL with transaction", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: "https://my-org.sentry.io/performance/summary/?transaction=/api/users",
            resourceType: undefined,
            organizationSlug: undefined,
            issueId: undefined,
            eventId: undefined,
            traceId: undefined,
            projectSlug: undefined,
            profilerId: undefined,
            transactionName: undefined,
            regionUrl: null,
          },
          baseContext,
        ),
      ).rejects.toThrow(
        'Detected a performance summary URL for transaction "/api/users"',
      );
    });
  });

  describe("Explicit mode", () => {
    it("fetches issue with explicit params", async () => {
      const result = await getSentryResource.handler(
        {
          url: undefined,
          resourceType: "issue",
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          eventId: undefined,
          traceId: undefined,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("fetches event with explicit params", async () => {
      const result = await getSentryResource.handler(
        {
          url: undefined,
          resourceType: "event",
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          eventId: "7ca573c0f4814912aaa9bdc77d1a7d51",
          traceId: undefined,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
    });

    it("fetches trace with explicit params", async () => {
      const traceId = "a4d1aae7216b47ff8117cf4e09ce9d0a";

      mswServer.use(
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace-meta/${traceId}/`,
          () => HttpResponse.json(traceMetaFixture),
          { once: true },
        ),
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace/${traceId}/`,
          () => HttpResponse.json(traceFixture),
          { once: true },
        ),
      );

      const result = await getSentryResource.handler(
        {
          url: undefined,
          resourceType: "trace",
          organizationSlug: "test-org",
          issueId: undefined,
          eventId: undefined,
          traceId,
          projectSlug: undefined,
          profilerId: undefined,
          transactionName: undefined,
          regionUrl: null,
        },
        baseContext,
      );

      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
      expect(result).toContain("**Total Spans**: 112");
      expect(result).toContain("**Errors**: 0");
    });
  });

  describe("Validation errors", () => {
    it("throws error when neither url nor resourceType provided", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: undefined,
            resourceType: undefined,
            organizationSlug: "my-org",
            issueId: "PROJECT-123",
            eventId: undefined,
            traceId: undefined,
            projectSlug: undefined,
            profilerId: undefined,
            transactionName: undefined,
            regionUrl: null,
          },
          baseContext,
        ),
      ).rejects.toThrow("Either `url` or `resourceType` must be provided");
    });

    it("throws error when organizationSlug missing for explicit mode", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: undefined,
            resourceType: "issue",
            organizationSlug: undefined,
            issueId: "PROJECT-123",
            eventId: undefined,
            traceId: undefined,
            projectSlug: undefined,
            profilerId: undefined,
            transactionName: undefined,
            regionUrl: null,
          },
          baseContext,
        ),
      ).rejects.toThrow(
        "`organizationSlug` is required when using explicit `resourceType`",
      );
    });

    it("throws error when issueId missing for issue type", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: undefined,
            resourceType: "issue",
            organizationSlug: "my-org",
            issueId: undefined,
            eventId: undefined,
            traceId: undefined,
            projectSlug: undefined,
            profilerId: undefined,
            transactionName: undefined,
            regionUrl: null,
          },
          baseContext,
        ),
      ).rejects.toThrow("`issueId` is required for resource type 'issue'");
    });

    it("throws error when traceId missing for trace type", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: undefined,
            resourceType: "trace",
            organizationSlug: "my-org",
            issueId: undefined,
            eventId: undefined,
            traceId: undefined,
            projectSlug: undefined,
            profilerId: undefined,
            transactionName: undefined,
            regionUrl: null,
          },
          baseContext,
        ),
      ).rejects.toThrow("`traceId` is required for resource type 'trace'");
    });

    it("throws error when projectSlug missing for profile type", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: undefined,
            resourceType: "profile",
            organizationSlug: "my-org",
            issueId: undefined,
            eventId: undefined,
            traceId: undefined,
            projectSlug: undefined,
            profilerId: undefined,
            transactionName: "GET /api/users",
            regionUrl: null,
          },
          baseContext,
        ),
      ).rejects.toThrow(
        "`projectSlug` is required for resource type 'profile'",
      );
    });

    it("throws error when transactionName missing for profile type", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: undefined,
            resourceType: "profile",
            organizationSlug: "my-org",
            issueId: undefined,
            eventId: undefined,
            traceId: undefined,
            projectSlug: "backend",
            profilerId: undefined,
            transactionName: undefined,
            regionUrl: null,
          },
          baseContext,
        ),
      ).rejects.toThrow(
        "`transactionName` is required for resource type 'profile'",
      );
    });
  });

  describe("Tool metadata", () => {
    it("is marked as experimental", () => {
      expect(getSentryResource.experimental).toBe(true);
    });

    it("has read-only annotation", () => {
      expect(getSentryResource.annotations.readOnlyHint).toBe(true);
    });

    it("belongs to inspect skill", () => {
      expect(getSentryResource.skills).toContain("inspect");
    });
  });
});
