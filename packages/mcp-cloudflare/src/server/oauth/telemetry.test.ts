import { describe, expect, it } from "vitest";
import {
  bucketOAuthErrorCode,
  bucketOAuthErrorDescription,
  getOAuthErrorTelemetry,
  getOAuthGrantTelemetry,
  getOAuthTokenShape,
} from "./telemetry";

describe("OAuth telemetry", () => {
  it("buckets bearer token shapes without exposing token values", () => {
    expect(getOAuthTokenShape(new Request("https://mcp.sentry.dev/mcp"))).toBe(
      "missing",
    );
    expect(
      getOAuthTokenShape(
        new Request("https://mcp.sentry.dev/mcp", {
          headers: { Authorization: "Basic abc" },
        }),
      ),
    ).toBe("non_bearer");
    expect(
      getOAuthTokenShape(
        new Request("https://mcp.sentry.dev/mcp", {
          headers: { Authorization: "Bearer " },
        }),
      ),
    ).toBe("empty_bearer");
    expect(
      getOAuthTokenShape(
        new Request("https://mcp.sentry.dev/mcp", {
          headers: { Authorization: "Bearer user-id:grant-id:secret" },
        }),
      ),
    ).toBe("wrapper");
    expect(
      getOAuthTokenShape(
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
      oauthError: "invalid_token",
      oauthErrorDescription: "missing_invalid_or_expired_access_token",
      oauthTokenShape: "wrapper",
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
      oauthError: "invalid_token",
      oauthErrorDescription: "invalid_access_token",
      oauthTokenShape: "wrapper",
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
      oauthErrorDescription: "grant_not_found",
    });
  });

  it("keeps error description cardinality bounded", () => {
    expect(bucketOAuthErrorDescription("Unexpected vendor message")).toBe(
      "other",
    );
  });

  it("keeps OAuth error code cardinality bounded", async () => {
    expect(bucketOAuthErrorCode("invalid_token")).toBe("invalid_token");
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
      oauthErrorDescription: "other",
    });
  });

  it("projects grant IDs into deterministic non-secret telemetry", () => {
    const first = getOAuthGrantTelemetry("grant-id");
    const second = getOAuthGrantTelemetry("grant-id");
    const other = getOAuthGrantTelemetry("other-grant-id");

    expect(first).toEqual(second);
    expect(first["app.oauth.grant.id_hash"]).toMatch(/^[0-9a-f]{8}$/);
    expect(first["app.oauth.grant.id_hash"]).not.toBe("grant-id");
    expect(other["app.oauth.grant.id_hash"]).not.toBe(
      first["app.oauth.grant.id_hash"],
    );
    expect(JSON.stringify(first)).not.toContain("grant-id");
  });
});
