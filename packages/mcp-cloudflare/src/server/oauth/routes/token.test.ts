import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../types";
import {
  encryptPropsWithNewKey,
  generateAuthCode,
  generateGrantId,
  generateToken,
  generateTokenId,
  hashSecret,
  wrapKeyWithToken,
} from "../crypto";
import { type InMemoryStorage, createInMemoryStorage } from "../storage";
import type { Grant, WorkerProps } from "../types";
import tokenRoute from "./token";

// Mock fetch for upstream token refresh
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("token endpoint", () => {
  let app: Hono<{ Bindings: Env }>;
  let storage: InMemoryStorage;

  const mockEnv = {
    SENTRY_CLIENT_ID: "sentry-client-id",
    SENTRY_CLIENT_SECRET: "sentry-client-secret",
    SENTRY_HOST: "sentry.io",
  } as unknown as Env;

  const testProps: WorkerProps = {
    id: "user-123",
    accessToken: "sentry-access-token",
    refreshToken: "sentry-refresh-token",
    clientId: "test-client",
    scope: "org:read",
    grantedSkills: ["issues"],
    // Set expiry far in the future to avoid triggering upstream refresh in tests
    accessTokenExpiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours from now
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createInMemoryStorage();

    // Create test app with storage and env middleware
    app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("oauthStorage", storage);
      await next();
    });
    app.route("/token", tokenRoute);
  });

  // Helper to make requests with mock env
  function makeRequest(path: string, options: RequestInit) {
    return app.request(path, options, mockEnv);
  }

  async function createTestGrant(): Promise<{
    grant: Grant;
    authCode: string;
    encryptionKey: CryptoKey;
  }> {
    const grantId = generateGrantId();
    const userId = "user-123";
    const authCode = generateAuthCode(userId, grantId);
    const authCodeId = await hashSecret(authCode);

    const { encrypted, key } = await encryptPropsWithNewKey(testProps);
    const authCodeWrappedKey = await wrapKeyWithToken(authCode, key);

    const grant: Grant = {
      id: grantId,
      clientId: "test-client",
      userId,
      scope: ["org:read"],
      encryptedProps: JSON.stringify(encrypted),
      createdAt: Math.floor(Date.now() / 1000),
      authCodeId,
      authCodeWrappedKey,
    };

    await storage.saveGrant(grant);
    return { grant, authCode, encryptionKey: key };
  }

  describe("POST /token - authorization_code grant", () => {
    it("exchanges valid authorization code for tokens", async () => {
      const { authCode, grant } = await createTestGrant();

      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          client_id: grant.clientId,
        }),
      });

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
      };
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.token_type).toBe("bearer");
      expect(body.expires_in).toBeDefined();
    });

    it("rejects missing code", async () => {
      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "test-client",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });

    it("rejects missing client_id", async () => {
      const { authCode } = await createTestGrant();

      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });

    it("rejects invalid authorization code format", async () => {
      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "invalid-code",
          client_id: "test-client",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_grant");
    });

    it("rejects reused authorization code", async () => {
      const { authCode, grant } = await createTestGrant();

      // First exchange should succeed
      const response1 = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          client_id: grant.clientId,
        }),
      });
      expect(response1.status).toBe(200);

      // Second exchange should fail
      const response2 = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          client_id: grant.clientId,
        }),
      });
      expect(response2.status).toBe(400);
      const body = (await response2.json()) as { error: string };
      expect(body.error).toBe("invalid_grant");
    });

    it("rejects client_id mismatch", async () => {
      const { authCode } = await createTestGrant();

      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          client_id: "wrong-client",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_grant");
    });
  });

  describe("POST /token - refresh_token grant", () => {
    async function createTestTokens() {
      const grantId = generateGrantId();
      const userId = "user-123";

      const { encrypted, key } = await encryptPropsWithNewKey(testProps);
      const refreshToken = generateToken(userId, grantId);
      const refreshTokenId = await generateTokenId(refreshToken);
      const wrappedKey = await wrapKeyWithToken(refreshToken, key);

      // Create grant without auth code (code already exchanged)
      const grant: Grant = {
        id: grantId,
        clientId: "test-client",
        userId,
        scope: ["org:read"],
        encryptedProps: JSON.stringify(encrypted),
        createdAt: Math.floor(Date.now() / 1000),
      };

      await storage.saveGrant(grant);

      // Create refresh token
      const refreshTokenTTL = 30 * 24 * 3600; // 30 days
      await storage.saveToken(
        {
          id: refreshTokenId,
          grantId,
          userId,
          createdAt: Math.floor(Date.now() / 1000),
          expiresAt: Math.floor(Date.now() / 1000) + refreshTokenTTL,
          wrappedEncryptionKey: wrappedKey,
          grant: {
            clientId: grant.clientId,
            scope: grant.scope,
            encryptedProps: grant.encryptedProps,
          },
        },
        refreshTokenTTL,
      );

      return { grant, refreshToken };
    }

    it("exchanges valid refresh token for new tokens", async () => {
      const { refreshToken } = await createTestTokens();

      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        token_type: string;
      };
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.token_type).toBe("bearer");
    });

    it("rejects missing refresh_token", async () => {
      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });

    it("rejects invalid refresh token format", async () => {
      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: "invalid-token",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_grant");
    });
  });

  describe("POST /token - unsupported grant types", () => {
    it("rejects unsupported grant type", async () => {
      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unsupported_grant_type");
    });

    it("rejects missing grant_type", async () => {
      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({}),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unsupported_grant_type");
    });
  });

  describe("response headers", () => {
    it("includes cache-control headers on success", async () => {
      const { authCode, grant } = await createTestGrant();

      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          client_id: grant.clientId,
        }),
      });

      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Pragma")).toBe("no-cache");
    });

    it("includes cache-control headers on error", async () => {
      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "invalid",
        }),
      });

      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Pragma")).toBe("no-cache");
    });
  });
});
