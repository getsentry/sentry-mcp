import type { TokenExchangeCallbackOptions } from "@cloudflare/workers-oauth-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerProps } from "../types";
import {
  createResourceValidationError,
  tokenExchangeCallback,
  validateResourceParameter,
} from "./helpers";

const GRANT_TYPES = {
  AUTHORIZATION_CODE:
    "authorization_code" as TokenExchangeCallbackOptions["grantType"],
  REFRESH_TOKEN: "refresh_token" as TokenExchangeCallbackOptions["grantType"],
};

function createRefreshOptions(
  propsOverrides?: Partial<WorkerProps>,
): TokenExchangeCallbackOptions {
  return {
    grantType: GRANT_TYPES.REFRESH_TOKEN,
    clientId: "test-client-id",
    userId: "test-user-id",
    scope: ["org:read", "project:read"],
    requestedScope: ["org:read", "project:read"],
    props: {
      id: "user-id",
      clientId: "test-client-id",
      scope: "org:read project:read",
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      ...propsOverrides,
    } as WorkerProps,
  };
}

const TEST_ENV = { SENTRY_HOST: "sentry.io" };

describe("tokenExchangeCallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return undefined for non-refresh_token grant types", async () => {
    const options: TokenExchangeCallbackOptions = {
      grantType: GRANT_TYPES.AUTHORIZATION_CODE,
      clientId: "test-client-id",
      userId: "test-user-id",
      scope: ["org:read", "project:read"],
      requestedScope: ["org:read", "project:read"],
      props: {} as WorkerProps,
    };

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toBeUndefined();
  });

  it("should return undefined when no refresh token in props", async () => {
    const futureExpiry = Date.now() + 10 * 60 * 1000;
    const options = createRefreshOptions({
      refreshToken: undefined,
      accessTokenExpiresAt: futureExpiry,
    });

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toEqual({
      newProps: expect.objectContaining({
        refreshToken: undefined,
      }),
      accessTokenTTL: expect.any(Number),
    });
  });

  it("should probe upstream and keep legacy grant usable when refresh token is missing", async () => {
    const pastExpiry = Date.now() - 60 * 1000;
    const options = createRefreshOptions({
      refreshToken: undefined,
      accessTokenExpiresAt: pastExpiry,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "1", name: "Test", email: "test@example.com" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toEqual({
      newProps: expect.objectContaining({
        refreshToken: undefined,
      }),
      accessTokenTTL: 60 * 60,
    });
  });

  it("should probe upstream and return undefined when token is truly expired", async () => {
    const pastExpiry = Date.now() - 60 * 1000; // 1 minute ago
    const options = createRefreshOptions({
      accessTokenExpiresAt: pastExpiry,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid token" }), {
        status: 401,
      }),
    );

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toBeUndefined();
  });

  it("should treat 400 probe failures as expired", async () => {
    const pastExpiry = Date.now() - 60 * 1000;
    const options = createRefreshOptions({
      accessTokenExpiresAt: pastExpiry,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid token" }), {
        status: 400,
        statusText: "Bad Request",
      }),
    );

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toBeUndefined();
  });

  it("should return undefined when upstream probe fails with network error", async () => {
    const pastExpiry = Date.now() - 60 * 1000;
    const options = createRefreshOptions({
      accessTokenExpiresAt: pastExpiry,
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toBeUndefined();
  });

  it("should return cached token TTL when token is locally valid", async () => {
    const futureExpiry = Date.now() + 10 * 60 * 1000;
    const options = createRefreshOptions({
      accessTokenExpiresAt: futureExpiry,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toEqual({
      newProps: expect.objectContaining({
        accessToken: "old-access-token",
      }),
      accessTokenTTL: expect.any(Number),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("should probe upstream when token is within safety window", async () => {
    const nearExpiry = Date.now() + 1 * 60 * 1000; // 1 minute from now (< 2 min safety window)
    const options = createRefreshOptions({
      accessTokenExpiresAt: nearExpiry,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid token" }), {
        status: 401,
      }),
    );

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toBeUndefined();
  });

  it("should probe upstream when no expiry is set", async () => {
    const options = createRefreshOptions({
      accessTokenExpiresAt: undefined,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid token" }), {
        status: 401,
      }),
    );

    const result = await tokenExchangeCallback(options, TEST_ENV);
    expect(result).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});

describe("validateResourceParameter", () => {
  describe("valid resources", () => {
    it("should allow undefined resource (optional parameter)", () => {
      const result = validateResourceParameter(
        undefined,
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should allow same hostname with /mcp path", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should reject same hostname with origin-only resource", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject same hostname with origin-only resource and trailing slash", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should allow same hostname with nested /mcp path", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp/org/project",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should allow same hostname with organization-scoped /mcp path", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp/org",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should allow localhost with /mcp path", () => {
      const result = validateResourceParameter(
        "http://localhost:8787/mcp",
        "http://localhost:8787/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should allow resource with query parameters", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp?foo=bar",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should allow resource with different port when both match", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev:8443/mcp",
        "https://mcp.sentry.dev:8443/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should allow explicit default port 443 for https", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev:443/mcp",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should allow explicit default port 80 for http", () => {
      const result = validateResourceParameter(
        "http://localhost:80/mcp",
        "http://localhost/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should allow 127.0.0.1 with /mcp path", () => {
      const result = validateResourceParameter(
        "http://127.0.0.1:3000/mcp",
        "http://127.0.0.1:3000/oauth/authorize",
      );
      expect(result).toBe(true);
    });
  });

  describe("invalid resources", () => {
    it("should reject different hostname", () => {
      const result = validateResourceParameter(
        "https://attacker.com/mcp",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject different subdomain", () => {
      const result = validateResourceParameter(
        "https://evil.sentry.dev/mcp",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject invalid path (not /mcp)", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/api",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject path without /mcp prefix", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/oauth",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject path with /mcp prefix but no separator", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcpadmin",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject path with /mcp- prefix", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp-evil",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject malformed URL", () => {
      const result = validateResourceParameter(
        "not-a-url",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject relative path", () => {
      const result = validateResourceParameter(
        "/mcp",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject empty string", () => {
      const result = validateResourceParameter(
        "",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject different port", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev:8080/mcp",
        "https://mcp.sentry.dev:443/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject different protocol (http vs https)", () => {
      const result = validateResourceParameter(
        "http://mcp.sentry.dev/mcp",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject javascript: scheme", () => {
      const result = validateResourceParameter(
        "javascript:alert(1)",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject data: scheme", () => {
      const result = validateResourceParameter(
        "data:text/html,<script>alert(1)</script>",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should reject URL with fragment (RFC 8707)", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp#fragment",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject URL with empty fragment (RFC 8707)", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev#",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should handle URL with trailing slash", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp/",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should handle case sensitivity in hostname", () => {
      const result = validateResourceParameter(
        "https://MCP.SENTRY.DEV/mcp",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should be case-sensitive for path", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/MCP",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject URL-encoded slashes in path", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp%2Forg",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(false);
    });

    it("should reject any percent-encoded characters in path", () => {
      const testCases = [
        "https://mcp.sentry.dev/mcp%2Forg",
        "https://mcp.sentry.dev/mcp/%2e%2e",
        "https://mcp.sentry.dev/mcp%20",
        "https://mcp.sentry.dev/mcp/test%00",
      ];

      for (const testCase of testCases) {
        const result = validateResourceParameter(
          testCase,
          "https://mcp.sentry.dev/oauth/authorize",
        );
        expect(result).toBe(false);
      }
    });

    it("should reject dot-segment traversal outside /mcp", () => {
      const testCases = [
        "https://mcp.sentry.dev/mcp/../evil",
        "https://mcp.sentry.dev/mcp/..",
      ];

      for (const testCase of testCases) {
        const result = validateResourceParameter(
          testCase,
          "https://mcp.sentry.dev/oauth/authorize",
        );
        expect(result).toBe(false);
      }
    });
  });
});

describe("createResourceValidationError", () => {
  it("should create redirect response with invalid_target error", () => {
    const response = createResourceValidationError(
      "https://client.example.com/callback",
      "state123",
    );

    expect(response.status).toBe(302);

    const location = response.headers.get("Location");
    expect(location).toBeDefined();

    const locationUrl = new URL(location!);
    expect(locationUrl.origin).toBe("https://client.example.com");
    expect(locationUrl.pathname).toBe("/callback");
    expect(locationUrl.searchParams.get("error")).toBe("invalid_target");
    expect(locationUrl.searchParams.get("error_description")).toContain(
      "resource parameter",
    );
    expect(locationUrl.searchParams.get("state")).toBe("state123");
  });

  it("should create redirect without state parameter if not provided", () => {
    const response = createResourceValidationError(
      "https://client.example.com/callback",
    );

    const location = response.headers.get("Location");
    expect(location).toBeDefined();

    const locationUrl = new URL(location!);
    expect(locationUrl.searchParams.get("error")).toBe("invalid_target");
    expect(locationUrl.searchParams.get("state")).toBeNull();
  });

  it("should preserve existing query parameters in redirect URI", () => {
    const response = createResourceValidationError(
      "https://client.example.com/callback?existing=param",
      "state456",
    );

    const location = response.headers.get("Location");
    const locationUrl = new URL(location!);

    expect(locationUrl.searchParams.get("existing")).toBe("param");
    expect(locationUrl.searchParams.get("error")).toBe("invalid_target");
    expect(locationUrl.searchParams.get("state")).toBe("state456");
  });

  it("should have proper error description per RFC 8707", () => {
    const response = createResourceValidationError(
      "https://client.example.com/callback",
    );

    const location = response.headers.get("Location");
    const locationUrl = new URL(location!);

    const errorDescription = locationUrl.searchParams.get("error_description");
    expect(errorDescription).toContain("authorization server");
  });
});
