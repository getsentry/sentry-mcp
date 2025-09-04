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
  });
});
