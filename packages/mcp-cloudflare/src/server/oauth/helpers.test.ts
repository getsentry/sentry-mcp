import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TokenExchangeCallbackOptions } from "@cloudflare/workers-oauth-provider";
import {
  tokenExchangeCallback,
  refreshAccessToken,
  validateResourceParameter,
  createResourceValidationError,
} from "./helpers";
import type { WorkerProps } from "../types";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("tokenExchangeCallback", () => {
  const mockEnv = {
    SENTRY_CLIENT_ID: "test-client-id",
    SENTRY_CLIENT_SECRET: "test-client-secret",
    SENTRY_HOST: "sentry.io",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip non-refresh_token grant types", async () => {
    const options: TokenExchangeCallbackOptions = {
      grantType: "authorization_code",
      clientId: "test-client-id",
      userId: "test-user-id",
      scope: ["org:read", "project:read"],
      props: {} as WorkerProps,
    };

    const result = await tokenExchangeCallback(options, mockEnv);
    expect(result).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should return undefined when no refresh token in props", async () => {
    const options: TokenExchangeCallbackOptions = {
      grantType: "refresh_token",
      clientId: "test-client-id",
      userId: "test-user-id",
      scope: ["org:read", "project:read"],
      props: {
        id: "user-id",
        clientId: "test-client-id",
        scope: "org:read project:read",
        accessToken: "old-access-token",
        // No refreshToken
      } as WorkerProps,
    };

    await expect(
      tokenExchangeCallback(options, mockEnv),
    ).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should reuse cached token when it has sufficient TTL remaining", async () => {
    const futureExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes from now
    const options: TokenExchangeCallbackOptions = {
      grantType: "refresh_token",
      clientId: "test-client-id",
      userId: "test-user-id",
      scope: ["org:read", "project:read"],
      props: {
        id: "user-id",
        clientId: "test-client-id",
        scope: "org:read project:read",
        accessToken: "cached-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: futureExpiry,
      } as WorkerProps,
    };

    const result = await tokenExchangeCallback(options, mockEnv);

    // Should not call upstream API
    expect(mockFetch).not.toHaveBeenCalled();

    // Should return existing props with calculated TTL
    expect(result).toBeDefined();
    expect(result?.newProps).toEqual(options.props);
    expect(result?.accessTokenTTL).toBeGreaterThan(0);
    expect(result?.accessTokenTTL).toBeLessThanOrEqual(600); // Max 10 minutes
  });

  it("should refresh token when cached token is close to expiry", async () => {
    const nearExpiry = Date.now() + 1 * 60 * 1000; // 1 minute from now (less than 2 min safety window)
    const options: TokenExchangeCallbackOptions = {
      grantType: "refresh_token",
      clientId: "test-client-id",
      userId: "test-user-id",
      scope: ["org:read", "project:read"],
      props: {
        id: "user-id",
        clientId: "test-client-id",
        scope: "org:read project:read",
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
        accessTokenExpiresAt: nearExpiry,
      } as WorkerProps,
    };

    // Mock successful refresh response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        token_type: "bearer",
        user: {
          id: "user-id",
          name: "Test User",
          email: "test@example.com",
        },
        scope: "org:read project:read",
      }),
    });

    const result = await tokenExchangeCallback(options, mockEnv);

    // Should call upstream API
    expect(mockFetch).toHaveBeenCalledWith(
      "https://sentry.io/oauth/token/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
        body: expect.stringContaining("grant_type=refresh_token"),
      }),
    );

    // Should return updated props with new tokens
    expect(result).toBeDefined();
    expect(result?.newProps).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      accessTokenExpiresAt: expect.any(Number),
    });
    expect(result?.accessTokenTTL).toBe(3600);
  });

  it("should refresh token when no cached expiry exists", async () => {
    const options: TokenExchangeCallbackOptions = {
      grantType: "refresh_token",
      clientId: "test-client-id",
      userId: "test-user-id",
      scope: ["org:read", "project:read"],
      props: {
        id: "user-id",
        clientId: "test-client-id",
        scope: "org:read project:read",
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
        // No accessTokenExpiresAt
      } as WorkerProps,
    };

    // Mock successful refresh response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        token_type: "bearer",
        user: {
          id: "user-id",
          name: "Test User",
          email: "test@example.com",
        },
        scope: "org:read project:read",
      }),
    });

    const result = await tokenExchangeCallback(options, mockEnv);

    // Should call upstream API
    expect(mockFetch).toHaveBeenCalled();

    // Should return updated props
    expect(result?.newProps).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      accessTokenExpiresAt: expect.any(Number),
    });
  });

  it("should throw error when upstream refresh fails", async () => {
    const options: TokenExchangeCallbackOptions = {
      grantType: "refresh_token",
      clientId: "test-client-id",
      userId: "test-user-id",
      scope: ["org:read", "project:read"],
      props: {
        id: "user-id",
        clientId: "test-client-id",
        scope: "org:read project:read",
        accessToken: "old-access-token",
        refreshToken: "invalid-refresh-token",
      } as WorkerProps,
    };

    // Mock failed refresh response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Invalid refresh token",
    });

    await expect(tokenExchangeCallback(options, mockEnv)).rejects.toThrow(
      "Failed to refresh upstream token in OAuth provider",
    );
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully refresh access token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        token_type: "bearer",
        user: {
          id: "user-id",
          name: "Test User",
          email: "test@example.com",
        },
        scope: "org:read project:read",
      }),
    });

    const [result, error] = await refreshAccessToken({
      client_id: "test-client",
      client_secret: "test-secret",
      refresh_token: "valid-refresh-token",
      upstream_url: "https://sentry.io/oauth/token/",
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
    });
  });

  it("should return error when refresh token is missing", async () => {
    const [result, error] = await refreshAccessToken({
      client_id: "test-client",
      client_secret: "test-secret",
      refresh_token: undefined,
      upstream_url: "https://sentry.io/oauth/token/",
    });

    expect(result).toBeNull();
    expect(error).toBeDefined();
    expect(error?.status).toBe(400);
    const text = await error?.text();
    expect(text).toBe("Invalid request: missing refresh token");
  });

  it("should return error when upstream returns non-OK status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Invalid token",
    });

    const [result, error] = await refreshAccessToken({
      client_id: "test-client",
      client_secret: "test-secret",
      refresh_token: "invalid-token",
      upstream_url: "https://sentry.io/oauth/token/",
    });

    expect(result).toBeNull();
    expect(error).toBeDefined();
    expect(error?.status).toBe(400);
    const text = await error?.text();
    expect(text).toContain("issue refreshing your access token");
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

    it("should allow same hostname with nested /mcp path", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp/org/project",
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

    it("should handle URL with trailing slash", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp/",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      expect(result).toBe(true);
    });

    it("should handle case sensitivity in hostname", () => {
      // URLs are case-insensitive for hostname
      const result = validateResourceParameter(
        "https://MCP.SENTRY.DEV/mcp",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      // This should work because URL constructor normalizes hostnames
      expect(result).toBe(true);
    });

    it("should be case-sensitive for path", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/MCP",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      // Paths are case-sensitive
      expect(result).toBe(false);
    });

    it("should handle URL encoding in path", () => {
      const result = validateResourceParameter(
        "https://mcp.sentry.dev/mcp%2Forg",
        "https://mcp.sentry.dev/oauth/authorize",
      );
      // URL encoding should be preserved
      expect(result).toBe(true);
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
