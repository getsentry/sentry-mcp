import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import {
  mswServer,
  traceMetaFixture,
  traceFixture,
  eventFixture,
} from "@sentry/mcp-server-mocks";
import getSentryResource from "./get-sentry-resource.js";

const baseContext = {
  constraints: {
    organizationSlug: undefined,
  },
  accessToken: "access-token",
  userId: "1",
};

function callHandler(params: {
  url?: string;
  resourceType?: "issue" | "event" | "trace" | "breadcrumbs";
  resourceId?: string;
  organizationSlug?: string;
}) {
  return getSentryResource.handler(params, baseContext);
}

describe("get_sentry_resource", () => {
  // ─── URL mode: issue URLs ──────────────────────────────────────────────────
  describe("URL mode — issue URLs", () => {
    it("resolves issue from subdomain URL (my-org.sentry.io)", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "Error: Tool list_organizations is already registered",
      );
    });

    it("resolves issue from path-based org URL (/{org}/issues/)", async () => {
      const result = await callHandler({
        url: "https://sentry.io/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("resolves issue from /organizations/{org}/ URL", async () => {
      const result = await callHandler({
        url: "https://sentry.io/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("resolves issue with trailing slash", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });
  });

  // ─── URL mode: event URLs ─────────────────────────────────────────────────
  describe("URL mode — event URLs", () => {
    it("resolves event from /issues/{id}/events/{eventId}", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
    });

    it("resolves event from path-based org URL", async () => {
      const result = await callHandler({
        url: "https://sentry.io/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51",
      });
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
    });
  });

  // ─── URL mode: trace URLs ─────────────────────────────────────────────────
  describe("URL mode — trace URLs", () => {
    const traceId = "a4d1aae7216b47ff8117cf4e09ce9d0a";

    function mockTraceEndpoints(org: string) {
      mswServer.use(
        http.get(
          `https://sentry.io/api/0/organizations/${org}/trace-meta/${traceId}/`,
          () => HttpResponse.json(traceMetaFixture),
          { once: true },
        ),
        http.get(
          `https://sentry.io/api/0/organizations/${org}/trace/${traceId}/`,
          () => HttpResponse.json(traceFixture),
          { once: true },
        ),
      );
    }

    it("resolves trace from /explore/traces/trace/{traceId}", async () => {
      mockTraceEndpoints("test-org");
      const result = await callHandler({
        url: `https://test-org.sentry.io/explore/traces/trace/${traceId}`,
      });
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
      expect(result).toContain("**Total Spans**: 112");
    });

    it("resolves trace from /performance/trace/{traceId}", async () => {
      mockTraceEndpoints("test-org");
      const result = await callHandler({
        url: `https://test-org.sentry.io/performance/trace/${traceId}`,
      });
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
    });

    it("resolves trace with span focus query param", async () => {
      mockTraceEndpoints("test-org");
      const result = await callHandler({
        url: `https://test-org.sentry.io/performance/trace/${traceId}?node=span-abc123`,
      });
      // Span focus is parsed but not yet used in output — just verify trace loads
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
    });

    it("resolves trace from /organizations/{org}/ path", async () => {
      mockTraceEndpoints("test-org");
      const result = await callHandler({
        url: `https://sentry.io/organizations/test-org/explore/traces/trace/${traceId}`,
      });
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
    });
  });

  // ─── URL mode: profile URLs ───────────────────────────────────────────────
  describe("URL mode — profile URLs", () => {
    it("dispatches profile from flamegraph URL to getProfile handler", async () => {
      // Profile handler requires transactionName which is not in the URL,
      // so it throws a clear error
      await expect(
        callHandler({
          url: "https://my-org.sentry.io/explore/profiling/profile/sentry/cfe78a5c/flamegraph/",
        }),
      ).rejects.toThrow("Transaction name is required");
    });

    it("dispatches profile from flamegraph URL with query params", async () => {
      await expect(
        callHandler({
          url: "https://sentry.sentry.io/explore/profiling/profile/sentry/cfe78a5c892d4a64a962d837673398d2/flamegraph/?colorCoding=by%20system%20vs%20application%20frame&frameName=SentryEnvMiddleware",
        }),
      ).rejects.toThrow("Transaction name is required");
    });

    it("dispatches profile from /profiling/profile/ URL (without /explore/)", async () => {
      await expect(
        callHandler({
          url: "https://my-org.sentry.io/profiling/profile/my-project/flamegraph/",
        }),
      ).rejects.toThrow("Transaction name is required");
    });

    it("dispatches profile from /organizations/ path variant", async () => {
      await expect(
        callHandler({
          url: "https://sentry.io/organizations/my-org/profiling/profile/my-project/flamegraph/",
        }),
      ).rejects.toThrow("Transaction name is required");
    });
  });

  // ─── URL mode: recognized-only types (guidance messages) ──────────────────
  describe("URL mode — recognized types (guidance messages)", () => {
    it("returns guidance for replay URL", async () => {
      const result = await callHandler({
        url: "https://my-org.sentry.io/replays/abc123def456/",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Replay Detected

        **Organization**: my-org
        **Replay ID**: abc123def456

        Session replay support is coming soon. In the meantime:

        - **View in Sentry**: [Open Replay](https://my-org.sentry.io/replays/abc123def456/)
        - **Find related issues**: Use \`search_issues\` with the replay's time range
        - **Search events**: Use \`search_events\` with query \`replay_id:abc123def456\` to find events associated with this replay"
      `);
    });

    it("returns guidance for monitor URL (simple slug)", async () => {
      const result = await callHandler({
        url: "https://my-org.sentry.io/crons/daily-backup/",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Cron Monitor Detected
        **Organization**: my-org
        **Monitor**: daily-backup
        Cron monitor support is coming soon. In the meantime:
        - **View in Sentry**: [Open Monitor](https://my-org.sentry.io/crons/daily-backup/)
        - **Search issues**: Use \`search_issues\` with query \`monitor.slug:daily-backup\` to find issues from this monitor"
      `);
    });

    it("returns guidance for monitor URL with project/slug path", async () => {
      const result = await callHandler({
        url: "https://my-org.sentry.io/crons/my-project/my-monitor/",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Cron Monitor Detected
        **Organization**: my-org
        **Monitor**: my-monitor
        **Project**: my-project
        Cron monitor support is coming soon. In the meantime:
        - **View in Sentry**: [Open Monitor](https://my-org.sentry.io/crons/my-project/my-monitor/)
        - **Search issues**: Use \`search_issues\` with query \`monitor.slug:my-monitor\` to find issues from this monitor"
      `);
    });

    it("returns guidance for release URL", async () => {
      const result = await callHandler({
        url: "https://my-org.sentry.io/releases/v1.2.3/",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Release Detected

        **Organization**: my-org
        **Release**: v1.2.3

        To get release information:

        - **View in Sentry**: [Open Release](https://my-org.sentry.io/releases/v1.2.3/)
        - **Find releases**: Use \`find_releases(organizationSlug='my-org')\` to list releases and their details
        - **Search issues**: Use \`search_issues\` with query \`release:v1.2.3\` to find issues in this release"
      `);
    });

    it("returns guidance for release URL with complex version", async () => {
      const result = await callHandler({
        url: "https://my-org.sentry.io/releases/backend@2024.01.15-abc123/",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Release Detected

        **Organization**: my-org
        **Release**: backend@2024.01.15-abc123

        To get release information:

        - **View in Sentry**: [Open Release](https://my-org.sentry.io/releases/backend@2024.01.15-abc123/)
        - **Find releases**: Use \`find_releases(organizationSlug='my-org')\` to list releases and their details
        - **Search issues**: Use \`search_issues\` with query \`release:backend@2024.01.15-abc123\` to find issues in this release"
      `);
    });
  });

  // ─── URL mode: error cases ────────────────────────────────────────────────
  describe("URL mode — error cases", () => {
    it("throws for unsupported URL path (settings)", async () => {
      await expect(
        callHandler({
          url: "https://sentry-mcp-evals.sentry.io/settings/projects/",
        }),
      ).rejects.toThrow("Could not determine resource type from URL");
    });

    it("throws helpful error for performance summary URL with transaction", async () => {
      await expect(
        callHandler({
          url: "https://my-org.sentry.io/performance/summary/?transaction=/api/users",
        }),
      ).rejects.toThrow(
        'Detected a performance summary URL for transaction "/api/users"',
      );
    });

    it("throws helpful error for encoded transaction names", async () => {
      await expect(
        callHandler({
          url: "https://my-org.sentry.io/performance/summary/?transaction=%2Fapi%2F0%2Forganizations",
        }),
      ).rejects.toThrow("Detected a performance summary URL for transaction");
    });
  });

  // ─── URL mode with resourceType override ──────────────────────────────────
  describe("URL mode with resourceType override", () => {
    it("fetches breadcrumbs from issue URL", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41",
        resourceType: "breadcrumbs",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
      expect(result).toContain("**Total Breadcrumbs**: 4");
      expect(result).toContain("fetch");
      expect(result).toContain("console");
      expect(result).toContain("navigation");
    });

    it("fetches breadcrumbs from event URL (extracts issueId)", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51",
        resourceType: "breadcrumbs",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
    });

    it("fetches breadcrumbs from path-based org URL", async () => {
      const result = await callHandler({
        url: "https://sentry.io/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        resourceType: "breadcrumbs",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
    });

    it("same resourceType as detected type just passes through (issue)", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41",
        resourceType: "issue",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("rejects unsupported override (issue on trace URL)", async () => {
      await expect(
        callHandler({
          url: "https://test-org.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a",
          resourceType: "issue",
        }),
      ).rejects.toThrow("Cannot override URL type with resourceType 'issue'");
    });

    it("rejects breadcrumbs override on non-issue URL (trace)", async () => {
      await expect(
        callHandler({
          url: "https://test-org.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a",
          resourceType: "breadcrumbs",
        }),
      ).rejects.toThrow("Could not extract issue ID from URL for breadcrumbs");
    });
  });

  // ─── Explicit mode ────────────────────────────────────────────────────────
  describe("Explicit mode", () => {
    it("fetches issue by shortId", async () => {
      const result = await callHandler({
        resourceType: "issue",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("uppercases issue resourceId", async () => {
      const result = await callHandler({
        resourceType: "issue",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "cloudflare-mcp-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("fetches event by eventId", async () => {
      const result = await callHandler({
        resourceType: "event",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "7ca573c0f4814912aaa9bdc77d1a7d51",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
    });

    it("fetches trace by traceId", async () => {
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

      const result = await callHandler({
        resourceType: "trace",
        organizationSlug: "test-org",
        resourceId: traceId,
      });
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
      expect(result).toContain("**Total Spans**: 112");
      expect(result).toContain("**Errors**: 0");
    });

    it("fetches breadcrumbs by issueId", async () => {
      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
      expect(result).toContain("**Total Breadcrumbs**: 4");
      expect(result).toContain("[fetch]");
      expect(result).toContain("[navigation]");
    });

    it("uppercases breadcrumbs resourceId", async () => {
      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "cloudflare-mcp-41",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
    });
  });

  // ─── Breadcrumbs output formatting ────────────────────────────────────────
  describe("Breadcrumbs output formatting", () => {
    it("formats breadcrumbs with table, data section, and usage hints", async () => {
      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Breadcrumbs for CLOUDFLARE-MCP-41

        **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51
        **Total Breadcrumbs**: 4

        \`\`\`
        2025-04-08T21:14:50.000Z info    [fetch] GET /api/0/organizations/ [200] {"method":"GET","url":"/api/0/organizations/","status_code":200}
        2025-04-08T21:14:52.000Z warning [console] Deprecation warning: use v2 endpoint
        2025-04-08T21:14:55.000Z info    [navigation] {"from":"/dashboard","to":"/settings"}
        2025-04-08T21:15:04.000Z error   [console] Tool list_organizations is already registered
        \`\`\`

        Breadcrumbs show the trail of events leading up to the error, in chronological order.
        Use \`get_sentry_resource(resourceType='issue', organizationSlug='...', resourceId='CLOUDFLARE-MCP-41')\` for full issue details."
      `);
    });

    it("handles event with no breadcrumbs gracefully", async () => {
      const eventNoBreadcrumbs = {
        ...eventFixture,
        entries: eventFixture.entries.filter(
          (e: { type: string }) => e.type !== "breadcrumbs",
        ),
      };

      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/latest/",
          () => HttpResponse.json(eventNoBreadcrumbs),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Breadcrumbs for CLOUDFLARE-MCP-41

        **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51

        No breadcrumbs found in the latest event for this issue."
      `);
    });

    it("handles event with empty breadcrumbs array", async () => {
      const eventEmptyBreadcrumbs = {
        ...eventFixture,
        entries: [
          ...eventFixture.entries.filter(
            (e: { type: string }) => e.type !== "breadcrumbs",
          ),
          { type: "breadcrumbs", data: { values: [] } },
        ],
      };

      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/latest/",
          () => HttpResponse.json(eventEmptyBreadcrumbs),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Breadcrumbs for CLOUDFLARE-MCP-41

        **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51

        No breadcrumbs found in the latest event for this issue."
      `);
    });
  });

  // ─── Validation errors ────────────────────────────────────────────────────
  describe("Validation errors", () => {
    it("throws when neither url nor resourceType provided", async () => {
      await expect(
        callHandler({ organizationSlug: "my-org", resourceId: "X-1" }),
      ).rejects.toThrow("Either `url` or `resourceType` must be provided");
    });

    it("throws when organizationSlug missing for explicit mode", async () => {
      await expect(
        callHandler({ resourceType: "issue", resourceId: "PROJECT-123" }),
      ).rejects.toThrow(
        "`organizationSlug` is required when using explicit `resourceType`",
      );
    });

    it("throws when resourceId missing for issue type", async () => {
      await expect(
        callHandler({
          resourceType: "issue",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow(
        "`resourceId` is required when using explicit `resourceType`",
      );
    });

    it("throws when resourceId missing for event type", async () => {
      await expect(
        callHandler({
          resourceType: "event",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow(
        "`resourceId` is required when using explicit `resourceType`",
      );
    });

    it("throws when resourceId missing for trace type", async () => {
      await expect(
        callHandler({
          resourceType: "trace",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow(
        "`resourceId` is required when using explicit `resourceType`",
      );
    });

    it("throws when resourceId missing for breadcrumbs type", async () => {
      await expect(
        callHandler({
          resourceType: "breadcrumbs",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow(
        "`resourceId` is required when using explicit `resourceType`",
      );
    });

    it("throws for unsupported explicit resourceType (profile)", async () => {
      await expect(
        callHandler({
          resourceType: "profile" as "issue",
          organizationSlug: "my-org",
          resourceId: "something",
        }),
      ).rejects.toThrow("Invalid resourceType: profile");
    });

    it("throws for unsupported explicit resourceType (replay)", async () => {
      await expect(
        callHandler({
          resourceType: "replay" as "issue",
          organizationSlug: "my-org",
          resourceId: "something",
        }),
      ).rejects.toThrow("Invalid resourceType: replay");
    });
  });

  // ─── Tool metadata ────────────────────────────────────────────────────────
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

    it("has simplified 4-param schema", () => {
      const schemaKeys = Object.keys(getSentryResource.inputSchema);
      expect(schemaKeys).toEqual([
        "url",
        "resourceType",
        "resourceId",
        "organizationSlug",
      ]);
    });
  });
});
