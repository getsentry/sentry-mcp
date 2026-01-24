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
          "traceId": "c6f3ccg9438d69110339eg6g2bef1f2c",
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
