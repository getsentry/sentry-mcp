import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import oauthRoute from "./index";
import { signState, type OAuthState } from "./state";
import type { Env } from "../types";

// Mock the OAuth provider
const mockOAuthProvider = {
  parseAuthRequest: vi.fn(),
  lookupClient: vi.fn(),
  completeAuthorization: vi.fn(),
};

function createTestApp(env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/oauth", oauthRoute);
  return app;
}

describe("oauth callback routes", () => {
  let app: ReturnType<typeof createTestApp>;
  let testEnv: Partial<Env>;

  beforeEach(() => {
    vi.clearAllMocks();
    testEnv = {
      OAUTH_PROVIDER: mockOAuthProvider as unknown as Env["OAUTH_PROVIDER"],
      COOKIE_SECRET: "test-secret-key",
      SENTRY_CLIENT_ID: "test-client-id",
      SENTRY_CLIENT_SECRET: "test-client-secret",
      SENTRY_HOST: "sentry.io",
    };
    app = createTestApp(testEnv);
  });

  describe("GET /oauth/callback", () => {
    it("should reject callback with invalid state param", async () => {
      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=%%%INVALID%%%`,
        { method: "GET" },
      );
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe("Invalid state");
    });

    it("should reject callback without approved client cookie", async () => {
      // Build signed state matching what /oauth/authorize issues
      const now = Date.now();
      const payload: OAuthState = {
        req: {
          clientId: "test-client",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
        },
        iat: now,
        exp: now + 10 * 60 * 1000,
      } as unknown as OAuthState;
      const signedState = await signState(payload, testEnv.COOKIE_SECRET!);

      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${signedState}`,
        {
          method: "GET",
          headers: {},
        },
      );
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).toBe("Authorization failed: Client not approved");
    });

    it("should reject callback with invalid client approval cookie", async () => {
      const now = Date.now();
      const payload: OAuthState = {
        req: {
          clientId: "test-client",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
        },
        iat: now,
        exp: now + 10 * 60 * 1000,
      } as unknown as OAuthState;
      const signedState = await signState(payload, testEnv.COOKIE_SECRET!);

      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${signedState}`,
        {
          method: "GET",
          headers: {
            Cookie: "mcp-approved-clients=invalid-cookie-value",
          },
        },
      );
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).toBe("Authorization failed: Client not approved");
    });

    it("should reject callback with cookie for different client", async () => {
      // Ensure authorize POST accepts the redirectUri
      mockOAuthProvider.lookupClient.mockResolvedValueOnce({
        clientId: "different-client",
        clientName: "Other Client",
        redirectUris: ["https://example.com/callback"],
        tokenEndpointAuthMethod: "client_secret_basic",
      });

      const approvalFormData = new FormData();
      approvalFormData.append(
        "state",
        btoa(
          JSON.stringify({
            oauthReqInfo: {
              clientId: "different-client",
              redirectUri: "https://example.com/callback",
              scope: ["read"],
            },
          }),
        ),
      );
      const approvalRequest = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: approvalFormData,
      });
      const approvalResponse = await app.fetch(approvalRequest, testEnv as Env);
      expect(approvalResponse.status).toBe(302);
      const setCookie = approvalResponse.headers.get("Set-Cookie");
      expect(setCookie).toBeTruthy();

      // Build a signed state for a different client than the approved one
      const now = Date.now();
      const payload: OAuthState = {
        req: {
          clientId: "test-client",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
        },
        iat: now,
        exp: now + 10 * 60 * 1000,
      } as unknown as OAuthState;
      const signedState = await signState(payload, testEnv.COOKIE_SECRET!);

      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${signedState}`,
        {
          method: "GET",
          headers: {
            Cookie: setCookie!.split(";")[0],
          },
        },
      );
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).toBe("Authorization failed: Client not approved");
    });

    it("should reject callback when state signature is tampered", async () => {
      // Ensure client redirectUri is registered
      mockOAuthProvider.lookupClient.mockResolvedValueOnce({
        clientId: "test-client",
        clientName: "Test Client",
        redirectUris: ["https://example.com/callback"],
        tokenEndpointAuthMethod: "client_secret_basic",
      });

      // Prepare approval POST to generate a signed state
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };
      const approvalFormData = new FormData();
      approvalFormData.append(
        "state",
        btoa(
          JSON.stringify({
            oauthReqInfo,
          }),
        ),
      );
      const approvalRequest = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: approvalFormData,
      });
      const approvalResponse = await app.fetch(approvalRequest, testEnv as Env);
      expect(approvalResponse.status).toBe(302);
      const setCookie = approvalResponse.headers.get("Set-Cookie");
      const location = approvalResponse.headers.get("location");
      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);
      const signedState = redirectUrl.searchParams.get("state")!;

      // Tamper with the signature portion (hex) without breaking payload parsing
      const [sig, b64] = signedState.split(".");
      const badSig = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
      const tamperedState = `${badSig}.${b64}`;

      // Call callback with tampered state and valid approval cookie
      const callbackRequest = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${tamperedState}`,
        {
          method: "GET",
          headers: {
            Cookie: setCookie!.split(";")[0],
          },
        },
      );
      const response = await app.fetch(callbackRequest, testEnv as Env);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe("Invalid state");
    });
  });

  describe("Resource parameter validation (RFC 8707)", () => {
    it("should allow callback without resource parameter", async () => {
      mockOAuthProvider.lookupClient.mockResolvedValue({
        clientId: "test-client",
        clientName: "Test Client",
        redirectUris: ["https://example.com/callback"],
      });

      // Submit approval to get approval cookie
      const approvalFormData = new FormData();
      approvalFormData.append(
        "state",
        btoa(
          JSON.stringify({
            oauthReqInfo: {
              clientId: "test-client",
              redirectUri: "https://example.com/callback",
              scope: ["read"],
            },
          }),
        ),
      );
      const approvalRequest = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: approvalFormData,
      });
      const approvalResponse = await app.fetch(approvalRequest, testEnv as Env);
      const setCookie = approvalResponse.headers.get("Set-Cookie");

      // Build signed state without resource
      const now = Date.now();
      const payload: OAuthState = {
        req: {
          clientId: "test-client",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
        },
        iat: now,
        exp: now + 10 * 60 * 1000,
      } as unknown as OAuthState;
      const signedState = await signState(payload, testEnv.COOKIE_SECRET!);

      // Should NOT call exchangeCodeForAccessToken in this test (we're just checking validation passes)
      // but if it were called, mock it to avoid actual network requests
      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${signedState}`,
        {
          method: "GET",
          headers: {
            Cookie: setCookie!.split(";")[0],
          },
        },
      );

      // This will fail at token exchange since we didn't mock it, but that's after validation
      // We just need to ensure it doesn't fail with "Invalid resource parameter"
      const response = await app.fetch(request, testEnv as Env);

      // Should not be 400 with "Invalid resource parameter"
      // It might be 500 or another error from token exchange, but that's OK
      if (response.status === 400) {
        const text = await response.text();
        expect(text).not.toContain("Invalid resource parameter");
      }
    });

    it("should allow callback with valid resource parameter", async () => {
      mockOAuthProvider.lookupClient.mockResolvedValue({
        clientId: "test-client",
        clientName: "Test Client",
        redirectUris: ["https://example.com/callback"],
      });

      // Submit approval to get approval cookie
      const approvalFormData = new FormData();
      approvalFormData.append(
        "state",
        btoa(
          JSON.stringify({
            oauthReqInfo: {
              clientId: "test-client",
              redirectUri: "https://example.com/callback",
              scope: ["read"],
              resource: "http://localhost/mcp",
            },
          }),
        ),
      );
      const approvalRequest = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: approvalFormData,
      });
      const approvalResponse = await app.fetch(approvalRequest, testEnv as Env);
      const setCookie = approvalResponse.headers.get("Set-Cookie");

      // Build signed state with valid resource
      const now = Date.now();
      const payload: OAuthState = {
        req: {
          clientId: "test-client",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
          resource: "http://localhost/mcp",
        },
        iat: now,
        exp: now + 10 * 60 * 1000,
      } as unknown as OAuthState;
      const signedState = await signState(payload, testEnv.COOKIE_SECRET!);

      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${signedState}`,
        {
          method: "GET",
          headers: {
            Cookie: setCookie!.split(";")[0],
          },
        },
      );

      const response = await app.fetch(request, testEnv as Env);

      // Should not be rejected for resource validation
      if (response.status === 400) {
        const text = await response.text();
        expect(text).not.toContain("Invalid resource parameter");
      }
    });

    it("should reject callback with invalid resource hostname", async () => {
      mockOAuthProvider.lookupClient.mockResolvedValue({
        clientId: "test-client",
        clientName: "Test Client",
        redirectUris: ["https://example.com/callback"],
      });

      // Build signed state with invalid resource
      // Note: We don't go through approval because it would reject the invalid resource
      const now = Date.now();
      const payload: OAuthState = {
        req: {
          clientId: "test-client",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
          resource: "https://attacker.com/mcp",
        },
        iat: now,
        exp: now + 10 * 60 * 1000,
      } as unknown as OAuthState;
      const signedState = await signState(payload, testEnv.COOKIE_SECRET!);

      // First approve a valid client to get the cookie
      const validApprovalFormData = new FormData();
      validApprovalFormData.append(
        "state",
        btoa(
          JSON.stringify({
            oauthReqInfo: {
              clientId: "test-client",
              redirectUri: "https://example.com/callback",
              scope: ["read"],
              // No resource parameter for the approval
            },
          }),
        ),
      );
      const validApprovalRequest = new Request(
        "http://localhost/oauth/authorize",
        {
          method: "POST",
          body: validApprovalFormData,
        },
      );
      const validApprovalResponse = await app.fetch(
        validApprovalRequest,
        testEnv as Env,
      );
      const setCookie = validApprovalResponse.headers.get("Set-Cookie");

      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${signedState}`,
        {
          method: "GET",
          headers: {
            Cookie: setCookie!.split(";")[0],
          },
        },
      );

      const response = await app.fetch(request, testEnv as Env);

      // Should be rejected with 400 error
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("Invalid resource parameter");
    });

    it("should reject callback with invalid resource path", async () => {
      mockOAuthProvider.lookupClient.mockResolvedValue({
        clientId: "test-client",
        clientName: "Test Client",
        redirectUris: ["https://example.com/callback"],
      });

      // Build signed state with invalid resource path
      // Note: We don't go through approval because it would reject the invalid resource
      const now = Date.now();
      const payload: OAuthState = {
        req: {
          clientId: "test-client",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
          resource: "http://localhost/api",
        },
        iat: now,
        exp: now + 10 * 60 * 1000,
      } as unknown as OAuthState;
      const signedState = await signState(payload, testEnv.COOKIE_SECRET!);

      // First approve a valid client to get the cookie
      const validApprovalFormData = new FormData();
      validApprovalFormData.append(
        "state",
        btoa(
          JSON.stringify({
            oauthReqInfo: {
              clientId: "test-client",
              redirectUri: "https://example.com/callback",
              scope: ["read"],
              // No resource parameter for the approval
            },
          }),
        ),
      );
      const validApprovalRequest = new Request(
        "http://localhost/oauth/authorize",
        {
          method: "POST",
          body: validApprovalFormData,
        },
      );
      const validApprovalResponse = await app.fetch(
        validApprovalRequest,
        testEnv as Env,
      );
      const setCookie = validApprovalResponse.headers.get("Set-Cookie");

      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${signedState}`,
        {
          method: "GET",
          headers: {
            Cookie: setCookie!.split(";")[0],
          },
        },
      );

      const response = await app.fetch(request, testEnv as Env);

      // Should be rejected with 400 error
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("Invalid resource parameter");
    });

    it("should reject empty resource parameter", async () => {
      mockOAuthProvider.lookupClient.mockResolvedValue({
        clientId: "test-client",
        clientName: "Test Client",
        redirectUris: ["https://example.com/callback"],
      });

      const now = Date.now();
      const payload: OAuthState = {
        req: {
          clientId: "test-client",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
          resource: "",
        },
        iat: now,
        exp: now + 10 * 60 * 1000,
      } as unknown as OAuthState;
      const signedState = await signState(payload, testEnv.COOKIE_SECRET!);

      // Get approval cookie
      const validApprovalFormData = new FormData();
      validApprovalFormData.append(
        "state",
        btoa(
          JSON.stringify({
            oauthReqInfo: {
              clientId: "test-client",
              redirectUri: "https://example.com/callback",
              scope: ["read"],
            },
          }),
        ),
      );
      const validApprovalRequest = new Request(
        "http://localhost/oauth/authorize",
        {
          method: "POST",
          body: validApprovalFormData,
        },
      );
      const validApprovalResponse = await app.fetch(
        validApprovalRequest,
        testEnv as Env,
      );
      const setCookie = validApprovalResponse.headers.get("Set-Cookie");

      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${signedState}`,
        {
          method: "GET",
          headers: {
            Cookie: setCookie!.split(";")[0],
          },
        },
      );

      const response = await app.fetch(request, testEnv as Env);

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("Invalid resource parameter");
    });
  });
});
