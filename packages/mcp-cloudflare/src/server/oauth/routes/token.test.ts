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
import type { ClientInfo, Grant, WorkerProps } from "../types";
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

  // Public test client (tokenEndpointAuthMethod: "none")
  const testClient: ClientInfo = {
    clientId: "test-client",
    redirectUris: ["https://example.com/callback"],
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    registrationDate: Math.floor(Date.now() / 1000),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    storage = createInMemoryStorage();

    // Register the test client
    await storage.saveClient(testClient);

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

      // Register a different client
      await storage.saveClient({
        clientId: "wrong-client",
        redirectUris: ["https://wrong.example.com/callback"],
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        registrationDate: Math.floor(Date.now() / 1000),
      });

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

    describe("redirect_uri verification (RFC 6749 Section 4.1.3)", () => {
      async function createTestGrantWithRedirectUri(
        redirectUri: string,
      ): Promise<{
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
          redirectUri,
        };

        await storage.saveGrant(grant);
        return { grant, authCode, encryptionKey: key };
      }

      it("accepts token exchange with matching redirect_uri", async () => {
        const redirectUri = "https://example.com/callback";
        const { authCode, grant } =
          await createTestGrantWithRedirectUri(redirectUri);

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            redirect_uri: redirectUri,
          }),
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { access_token: string };
        expect(body.access_token).toBeDefined();
      });

      it("rejects token exchange with different redirect_uri", async () => {
        const redirectUri = "https://example.com/callback";
        const { authCode, grant } =
          await createTestGrantWithRedirectUri(redirectUri);

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            redirect_uri: "https://example.com/different-callback",
          }),
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as {
          error: string;
          error_description: string;
        };
        expect(body.error).toBe("invalid_grant");
        expect(body.error_description).toBe("redirect_uri mismatch");
      });

      it("rejects token exchange without redirect_uri when one was used in authorization", async () => {
        const redirectUri = "https://example.com/callback";
        const { authCode, grant } =
          await createTestGrantWithRedirectUri(redirectUri);

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            // redirect_uri intentionally omitted
          }),
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as {
          error: string;
          error_description: string;
        };
        expect(body.error).toBe("invalid_grant");
        expect(body.error_description).toBe(
          "Missing required parameter: redirect_uri",
        );
      });

      it("accepts token exchange without redirect_uri when none was stored", async () => {
        // Use the default createTestGrant which doesn't set redirectUri
        const { authCode, grant } = await createTestGrant();

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            // redirect_uri intentionally omitted
          }),
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { access_token: string };
        expect(body.access_token).toBeDefined();
      });
    });

    describe("PKCE verification (RFC 7636)", () => {
      async function createTestGrantWithPKCE(
        codeChallenge: string,
        codeChallengeMethod: string,
      ): Promise<{
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
          codeChallenge,
          codeChallengeMethod,
        };

        await storage.saveGrant(grant);
        return { grant, authCode, encryptionKey: key };
      }

      it("accepts token exchange with valid PKCE verifier (plain method)", async () => {
        const codeVerifier = "test-verifier-12345";
        const codeChallenge = codeVerifier; // plain method
        const { authCode, grant } = await createTestGrantWithPKCE(
          codeChallenge,
          "plain",
        );

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            code_verifier: codeVerifier,
          }),
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { access_token: string };
        expect(body.access_token).toBeDefined();
      });

      it("accepts token exchange with valid PKCE verifier (S256 method)", async () => {
        // RFC 7636 test vector
        const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        const codeChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        const { authCode, grant } = await createTestGrantWithPKCE(
          codeChallenge,
          "S256",
        );

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            code_verifier: codeVerifier,
          }),
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { access_token: string };
        expect(body.access_token).toBeDefined();
      });

      it("rejects token exchange without code_verifier when PKCE was used", async () => {
        const { authCode, grant } = await createTestGrantWithPKCE(
          "some-challenge",
          "plain",
        );

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            // code_verifier intentionally omitted
          }),
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as {
          error: string;
          error_description: string;
        };
        expect(body.error).toBe("invalid_grant");
        expect(body.error_description).toContain("code_verifier");
      });

      it("rejects token exchange with invalid PKCE verifier", async () => {
        const { authCode, grant } = await createTestGrantWithPKCE(
          "correct-challenge",
          "plain",
        );

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            code_verifier: "wrong-verifier",
          }),
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as {
          error: string;
          error_description: string;
        };
        expect(body.error).toBe("invalid_grant");
        expect(body.error_description).toContain("code_verifier");
      });

      it("accepts token exchange without code_verifier when PKCE was not used", async () => {
        // Use the default createTestGrant which doesn't set PKCE
        const { authCode, grant } = await createTestGrant();

        const response = await makeRequest("/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            client_id: grant.clientId,
            // code_verifier intentionally omitted
          }),
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { access_token: string };
        expect(body.access_token).toBeDefined();
      });
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
          client_id: "test-client",
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
          client_id: "test-client",
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
          client_id: "test-client",
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
          client_id: "test-client",
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
        body: new URLSearchParams({
          client_id: "test-client",
        }),
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

  describe("invalid_client errors (RFC 6749 Section 5.2)", () => {
    it("returns 401 with WWW-Authenticate header for unknown client", async () => {
      const { authCode } = await createTestGrant();

      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          client_id: "unknown-client",
        }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'Basic realm="token"',
      );
      const body = (await response.json()) as {
        error: string;
        error_description: string;
      };
      expect(body.error).toBe("invalid_client");
    });

    it("returns 401 with WWW-Authenticate header for confidential client without credentials", async () => {
      // Register a confidential client
      const hashedSecret = await hashSecret("test-secret");
      await storage.saveClient({
        clientId: "confidential-client",
        clientSecret: hashedSecret,
        redirectUris: ["https://example.com/callback"],
        tokenEndpointAuthMethod: "client_secret_post",
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        registrationDate: Math.floor(Date.now() / 1000),
      });

      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "some-code",
          client_id: "confidential-client",
          // client_secret intentionally omitted
        }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'Basic realm="token"',
      );
      const body = (await response.json()) as {
        error: string;
        error_description: string;
      };
      expect(body.error).toBe("invalid_client");
    });

    it("returns 401 with WWW-Authenticate header for invalid client secret", async () => {
      // Register a confidential client
      const hashedSecret = await hashSecret("correct-secret");
      await storage.saveClient({
        clientId: "confidential-client",
        clientSecret: hashedSecret,
        redirectUris: ["https://example.com/callback"],
        tokenEndpointAuthMethod: "client_secret_post",
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        registrationDate: Math.floor(Date.now() / 1000),
      });

      const response = await makeRequest("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "some-code",
          client_id: "confidential-client",
          client_secret: "wrong-secret",
        }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'Basic realm="token"',
      );
      const body = (await response.json()) as {
        error: string;
        error_description: string;
      };
      expect(body.error).toBe("invalid_client");
    });
  });
});
