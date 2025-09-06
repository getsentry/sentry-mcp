import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import oauthRoute from "./index";
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
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };
      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${btoa(
          JSON.stringify(oauthReqInfo),
        )}`,
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
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };
      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${btoa(
          JSON.stringify(oauthReqInfo),
        )}`,
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
      const setCookie = approvalResponse.headers.get("Set-Cookie");
      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${btoa(
          JSON.stringify(oauthReqInfo),
        )}`,
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
});
