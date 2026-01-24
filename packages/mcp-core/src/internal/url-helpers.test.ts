import { describe, expect, it } from "vitest";
import { parseSentryUrl, isProfileUrl } from "./url-helpers";

describe("parseSentryUrl", () => {
  describe("issue URLs", () => {
    it("parses subdomain-based issue URL", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/issues/PROJECT-123"),
      ).toMatchInlineSnapshot(`
        {
          "issueId": "PROJECT-123",
          "organizationSlug": "my-org",
          "type": "issue",
        }
      `);
    });

    it("parses path-based organization issue URL", () => {
      expect(
        parseSentryUrl("https://sentry.io/my-org/issues/123"),
      ).toMatchInlineSnapshot(`
        {
          "issueId": "123",
          "organizationSlug": "my-org",
          "type": "issue",
        }
      `);
    });

    it("parses organizations path issue URL", () => {
      expect(
        parseSentryUrl("https://sentry.io/organizations/my-org/issues/456"),
      ).toMatchInlineSnapshot(`
        {
          "issueId": "456",
          "organizationSlug": "my-org",
          "type": "issue",
        }
      `);
    });

    it("parses self-hosted Sentry issue URL", () => {
      expect(
        parseSentryUrl("https://sentry.mycompany.com/issues/789"),
      ).toMatchInlineSnapshot(`
        {
          "issueId": "789",
          "organizationSlug": "sentry",
          "type": "issue",
        }
      `);
    });

    it("parses numeric issue ID", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/issues/12345"),
      ).toMatchInlineSnapshot(`
        {
          "issueId": "12345",
          "organizationSlug": "my-org",
          "type": "issue",
        }
      `);
    });
  });

  describe("event URLs", () => {
    it("parses issue event URL", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/issues/PROJECT-123/events/abc123def456",
        ),
      ).toMatchInlineSnapshot(`
        {
          "eventId": "abc123def456",
          "issueId": "PROJECT-123",
          "organizationSlug": "my-org",
          "type": "event",
        }
      `);
    });

    it("parses event URL with organizations path", () => {
      expect(
        parseSentryUrl(
          "https://sentry.io/organizations/my-org/issues/123/events/event456",
        ),
      ).toMatchInlineSnapshot(`
        {
          "eventId": "event456",
          "issueId": "123",
          "organizationSlug": "my-org",
          "type": "event",
        }
      `);
    });
  });

  describe("trace URLs", () => {
    it("parses explore traces URL", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "spanId": undefined,
          "traceId": "a4d1aae7216b47ff8117cf4e09ce9d0a",
          "type": "trace",
        }
      `);
    });

    it("parses performance trace URL", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/performance/trace/b5e2bbf8327c58009228df5f1ade0e1b",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "spanId": undefined,
          "traceId": "b5e2bbf8327c58009228df5f1ade0e1b",
          "type": "trace",
        }
      `);
    });

    it("parses trace URL with organizations path", () => {
      expect(
        parseSentryUrl(
          "https://sentry.io/organizations/my-org/explore/traces/trace/c6f3ccg9438d69110339eg6g2bef1f2c",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "spanId": undefined,
          "traceId": "c6f3ccg9438d69110339eg6g2bef1f2c",
          "type": "trace",
        }
      `);
    });

    it("parses trace URL with span focus query param", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/performance/trace/a4d1aae7216b47ff8117cf4e09ce9d0a?node=span-abc123def456",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "spanId": "abc123def456",
          "traceId": "a4d1aae7216b47ff8117cf4e09ce9d0a",
          "type": "trace",
        }
      `);
    });
  });

  describe("profile URLs", () => {
    it("parses explore profiling URL", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/explore/profiling/profile/my-project/flamegraph/",
        ),
      ).toMatchInlineSnapshot(`
        {
          "end": undefined,
          "organizationSlug": "my-org",
          "profilerId": undefined,
          "projectSlug": "my-project",
          "start": undefined,
          "type": "profile",
        }
      `);
    });

    it("parses profile URL with profilerId query param", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/explore/profiling/profile/seer/flamegraph/?profilerId=abc123",
        ),
      ).toMatchInlineSnapshot(`
        {
          "end": undefined,
          "organizationSlug": "my-org",
          "profilerId": "abc123",
          "projectSlug": "seer",
          "start": undefined,
          "type": "profile",
        }
      `);
    });

    it("parses profile URL with all query params", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/explore/profiling/profile/backend/flamegraph/?profilerId=xyz789&start=2024-01-01&end=2024-01-07",
        ),
      ).toMatchInlineSnapshot(`
        {
          "end": "2024-01-07",
          "organizationSlug": "my-org",
          "profilerId": "xyz789",
          "projectSlug": "backend",
          "start": "2024-01-01",
          "type": "profile",
        }
      `);
    });

    it("parses profile URL with organizations path", () => {
      expect(
        parseSentryUrl(
          "https://sentry.io/organizations/my-org/profiling/profile/my-project/flamegraph/",
        ),
      ).toMatchInlineSnapshot(`
        {
          "end": undefined,
          "organizationSlug": "my-org",
          "profilerId": undefined,
          "projectSlug": "my-project",
          "start": undefined,
          "type": "profile",
        }
      `);
    });
  });

  describe("replay URLs", () => {
    it("parses replay URL with subdomain", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/replays/abc123def456789/"),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "replayId": "abc123def456789",
          "type": "replay",
        }
      `);
    });

    it("parses replay URL with organizations path", () => {
      expect(
        parseSentryUrl(
          "https://sentry.io/organizations/my-org/replays/replay123/",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "replayId": "replay123",
          "type": "replay",
        }
      `);
    });

    it("parses replay URL without trailing slash", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/replays/abc123"),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "replayId": "abc123",
          "type": "replay",
        }
      `);
    });

    it("does not parse replay selectors URL as replay", () => {
      const result = parseSentryUrl(
        "https://my-org.sentry.io/replays/selectors/",
      );
      expect(result.type).toBe("unknown");
    });
  });

  describe("monitor/cron URLs", () => {
    it("parses crons URL with monitor slug", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/crons/my-cron-job/"),
      ).toMatchInlineSnapshot(`
        {
          "monitorSlug": "my-cron-job",
          "organizationSlug": "my-org",
          "type": "monitor",
        }
      `);
    });

    it("parses crons URL with project and monitor slug", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/crons/my-project/my-monitor/"),
      ).toMatchInlineSnapshot(`
        {
          "monitorSlug": "my-monitor",
          "organizationSlug": "my-org",
          "projectSlug": "my-project",
          "type": "monitor",
        }
      `);
    });

    it("parses monitors URL", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/monitors/heartbeat-check/"),
      ).toMatchInlineSnapshot(`
        {
          "monitorSlug": "heartbeat-check",
          "organizationSlug": "my-org",
          "type": "monitor",
        }
      `);
    });

    it("parses crons URL with organizations path", () => {
      expect(
        parseSentryUrl(
          "https://sentry.io/organizations/my-org/crons/daily-backup/",
        ),
      ).toMatchInlineSnapshot(`
        {
          "monitorSlug": "daily-backup",
          "organizationSlug": "my-org",
          "type": "monitor",
        }
      `);
    });

    it("does not parse crons/new URL as monitor", () => {
      const result = parseSentryUrl("https://my-org.sentry.io/crons/new/");
      expect(result.type).toBe("unknown");
    });
  });

  describe("release URLs", () => {
    it("parses release URL with version", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/releases/v1.2.3/"),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "releaseVersion": "v1.2.3",
          "type": "release",
        }
      `);
    });

    it("parses release URL with complex version", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/releases/backend@2024.01.15-abc123/",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "releaseVersion": "backend@2024.01.15-abc123",
          "type": "release",
        }
      `);
    });

    it("parses release URL with organizations path", () => {
      expect(
        parseSentryUrl(
          "https://sentry.io/organizations/my-org/releases/production-v5/",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "releaseVersion": "production-v5",
          "type": "release",
        }
      `);
    });

    it("does not parse releases redirect URLs", () => {
      const result = parseSentryUrl(
        "https://my-org.sentry.io/releases/new-events/",
      );
      expect(result.type).toBe("unknown");
    });
  });

  describe("performance summary URLs", () => {
    it("extracts transaction from performance summary URL", () => {
      expect(
        parseSentryUrl(
          "https://my-org.sentry.io/performance/summary/?transaction=/api/users",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "transaction": "/api/users",
          "type": "unknown",
        }
      `);
    });

    it("handles encoded transaction names", () => {
      const result = parseSentryUrl(
        "https://my-org.sentry.io/performance/summary/?transaction=%2Fapi%2Fusers%2F%3Aid",
      );
      expect(result.transaction).toBe("/api/users/:id");
      expect(result.type).toBe("unknown");
    });
  });

  describe("unknown URLs", () => {
    it("returns unknown for unrecognized path", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/settings/account"),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "type": "unknown",
        }
      `);
    });

    it("returns unknown for dashboard URL", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/dashboards/overview"),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "type": "unknown",
        }
      `);
    });

    it("returns unknown for discover URL", () => {
      expect(
        parseSentryUrl("https://my-org.sentry.io/discover/results/"),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "type": "unknown",
        }
      `);
    });
  });

  describe("region URL handling", () => {
    it("handles us.sentry.io region URL with org in path", () => {
      expect(
        parseSentryUrl("https://us.sentry.io/my-org/issues/123"),
      ).toMatchInlineSnapshot(`
        {
          "issueId": "123",
          "organizationSlug": "my-org",
          "type": "issue",
        }
      `);
    });

    it("handles eu.sentry.io region URL with organizations path", () => {
      expect(
        parseSentryUrl(
          "https://eu.sentry.io/organizations/my-org/replays/abc123/",
        ),
      ).toMatchInlineSnapshot(`
        {
          "organizationSlug": "my-org",
          "replayId": "abc123",
          "type": "replay",
        }
      `);
    });
  });

  describe("error handling", () => {
    it("throws for empty input", () => {
      expect(() => parseSentryUrl("")).toThrowErrorMatchingInlineSnapshot(
        `[UserInputError: Invalid Sentry URL. URL must be a non-empty string.]`,
      );
    });

    it("throws for non-string input", () => {
      // @ts-expect-error Testing runtime behavior
      expect(() => parseSentryUrl(null)).toThrowErrorMatchingInlineSnapshot(
        `[UserInputError: Invalid Sentry URL. URL must be a non-empty string.]`,
      );
    });

    it("throws for non-http URL", () => {
      expect(() =>
        parseSentryUrl("ftp://sentry.io/issues/123"),
      ).toThrowErrorMatchingInlineSnapshot(
        `[UserInputError: Invalid Sentry URL. Must start with http:// or https://]`,
      );
    });

    it("throws for invalid URL format", () => {
      expect(() =>
        parseSentryUrl("https://not a valid url"),
      ).toThrowErrorMatchingInlineSnapshot(
        `[UserInputError: Invalid Sentry URL. Unable to parse URL: https://not a valid url]`,
      );
    });
  });
});

describe("isProfileUrl", () => {
  it("returns true for profile URLs", () => {
    expect(
      isProfileUrl(
        "https://my-org.sentry.io/explore/profiling/profile/my-project/flamegraph/",
      ),
    ).toBe(true);
  });

  it("returns false for issue URLs", () => {
    expect(isProfileUrl("https://my-org.sentry.io/issues/123")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isProfileUrl("not-a-url")).toBe(false);
  });
});
