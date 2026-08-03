import { describe, expect, it } from "vitest";
import {
  bucketOAuthErrorCode,
  bucketOAuthErrorDescription,
  CLIENT_REGISTRATION_METHOD_ATTRIBUTE,
  getClientRegistrationMethodTelemetry,
  getOAuthErrorTelemetry,
  getOAuthGrantTelemetry,
  getOAuthGrantLifecycleTelemetry,
  getOAuthBearerShape,
  OAUTH_GRANT_AGE_BUCKET_ATTRIBUTE,
  OAUTH_GRANT_ID_HASH_ATTRIBUTE,
  OAUTH_UPSTREAM_EXPIRES_IN_BUCKET_ATTRIBUTE,
  resolveClientRegistrationMethod,
} from "./telemetry";

describe("OAuth telemetry", () => {
  it("buckets bearer token shapes without exposing token values", () => {
    expect(getOAuthBearerShape(new Request("https://mcp.sentry.dev/mcp"))).toBe(
      "missing",
    );
    expect(
      getOAuthBearerShape(
        new Request("https://mcp.sentry.dev/mcp", {
          headers: { Authorization: "Basic abc" },
        }),
      ),
    ).toBe("non_bearer");
    expect(
      getOAuthBearerShape(
        new Request("https://mcp.sentry.dev/mcp", {
          headers: { Authorization: "Bearer " },
        }),
      ),
    ).toBe("empty_bearer");
    expect(
      getOAuthBearerShape(
        new Request("https://mcp.sentry.dev/mcp", {
          headers: { Authorization: "Bearer user-id:grant-id:secret" },
        }),
      ),
    ).toBe("wrapper");
    expect(
      getOAuthBearerShape(
        new Request("https://mcp.sentry.dev/mcp", {
          headers: { Authorization: "Bearer opaque-token" },
        }),
      ),
    ).toBe("malformed");
  });

  it("extracts OAuth errors from WWW-Authenticate", async () => {
    const telemetry = await getOAuthErrorTelemetry(
      new Request("https://mcp.sentry.dev/mcp", {
        headers: { Authorization: "Bearer user-id:grant-id:secret" },
      }),
      new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer realm="OAuth", error="invalid_token", error_description="Missing, invalid, or expired access token"',
        },
      }),
    );

    expect(telemetry).toEqual({
      oauthError: "invalid_bearer",
      oauthErrorReason: "missing_invalid_or_expired_bearer",
      oauthBearerShape: "wrapper",
    });
  });

  it("uses JSON error descriptions when WWW-Authenticate only carries the error code", async () => {
    const telemetry = await getOAuthErrorTelemetry(
      new Request("https://mcp.sentry.dev/mcp", {
        headers: { Authorization: "Bearer user-id:grant-id:secret" },
      }),
      new Response(
        JSON.stringify({
          error: "invalid_token",
          error_description: "Invalid access token",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": 'Bearer error="invalid_token"',
          },
        },
      ),
    );

    expect(telemetry).toEqual({
      oauthError: "invalid_bearer",
      oauthErrorReason: "invalid_bearer",
      oauthBearerShape: "wrapper",
    });
  });

  it("extracts OAuth errors from JSON responses", async () => {
    const telemetry = await getOAuthErrorTelemetry(
      new Request("https://mcp.sentry.dev/oauth/token"),
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Grant not found",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    expect(telemetry).toEqual({
      oauthError: "invalid_grant",
      oauthErrorReason: "grant_not_found",
    });
  });

  it("keeps error description cardinality bounded", () => {
    expect(bucketOAuthErrorDescription("Unexpected vendor message")).toBe(
      "other",
    );
  });

  it("keeps OAuth error code cardinality bounded", async () => {
    expect(bucketOAuthErrorCode("invalid_token")).toBe("invalid_bearer");
    expect(bucketOAuthErrorCode("vendor-specific-error")).toBe("other");

    const telemetry = await getOAuthErrorTelemetry(
      new Request("https://mcp.sentry.dev/oauth/token"),
      new Response(
        JSON.stringify({
          error: "vendor-specific-error",
          error_description: "Unexpected vendor message",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    expect(telemetry).toEqual({
      oauthError: "other",
      oauthErrorReason: "other",
    });
  });

  it("projects grant IDs into deterministic non-secret telemetry", () => {
    const first = getOAuthGrantTelemetry("grant-id");
    const second = getOAuthGrantTelemetry("grant-id");
    const other = getOAuthGrantTelemetry("other-grant-id");

    expect(first).toEqual(second);
    expect(first[OAUTH_GRANT_ID_HASH_ATTRIBUTE]).toMatch(/^[0-9a-f]{8}$/);
    expect(first[OAUTH_GRANT_ID_HASH_ATTRIBUTE]).not.toBe("grant-id");
    expect(other[OAUTH_GRANT_ID_HASH_ATTRIBUTE]).not.toBe(
      first[OAUTH_GRANT_ID_HASH_ATTRIBUTE],
    );
    expect(JSON.stringify(first)).not.toContain("grant-id");
  });

  it("projects lifecycle timestamps into bounded diagnostic buckets", () => {
    const now = Date.now();

    expect(
      getOAuthGrantLifecycleTelemetry({
        sessionStartedAt: now - 2 * 24 * 60 * 60 * 1000,
        upstreamExpiresAt: now + 3 * 24 * 60 * 60 * 1000,
      }),
    ).toEqual({
      [OAUTH_GRANT_AGE_BUCKET_ATTRIBUTE]: "1d_7d",
      [OAUTH_UPSTREAM_EXPIRES_IN_BUCKET_ATTRIBUTE]: "1d_7d",
    });
    expect(getOAuthGrantLifecycleTelemetry({})).toEqual({
      [OAUTH_GRANT_AGE_BUCKET_ATTRIBUTE]: "unknown",
      [OAUTH_UPSTREAM_EXPIRES_IN_BUCKET_ATTRIBUTE]: "unknown",
    });
  });

  it("classifies client_ids as CIMD, DCR, or unknown", () => {
    expect(
      resolveClientRegistrationMethod(
        "https://claude.ai/oauth/claude-code-client-metadata",
      ),
    ).toBe("cimd");
    expect(
      resolveClientRegistrationMethod("  https://example.com/meta  "),
    ).toBe("cimd");
    expect(resolveClientRegistrationMethod("opaque-client-id")).toBe("dcr");
    expect(resolveClientRegistrationMethod("http://example.com/meta")).toBe(
      "unknown",
    );
    expect(resolveClientRegistrationMethod("")).toBe("unknown");
    expect(resolveClientRegistrationMethod("   ")).toBe("unknown");
    expect(resolveClientRegistrationMethod(undefined)).toBe("unknown");
    expect(resolveClientRegistrationMethod(null)).toBe("unknown");
    expect(
      getClientRegistrationMethodTelemetry(
        "https://claude.ai/oauth/claude-code-client-metadata",
      ),
    ).toEqual({
      [CLIENT_REGISTRATION_METHOD_ATTRIBUTE]: "cimd",
    });
  });
});
