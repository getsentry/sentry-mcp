import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TokenExchangeCallbackOptions } from "@cloudflare/workers-oauth-provider";
import { tokenExchangeCallback, refreshAccessToken } from "./helpers";
import type { WorkerProps } from "../types";

// Mock the logIssue function
vi.mock("@sentry/mcp-server/logging", () => ({
  logIssue: vi.fn(),
}));

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
        name: "Test User",
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
        name: "Test User",
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
        name: "Test User",
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
        name: "Test User",
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
        name: "Test User",
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
