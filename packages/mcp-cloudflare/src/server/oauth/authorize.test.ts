import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import oauthRoute from "./index";
import type { Env } from "../types";
import { verifyAndParseState } from "./state";

// Mock the OAuth provider
const mockOAuthProvider = {
  parseAuthRequest: vi.fn(),
  lookupClient: vi.fn(),
  completeAuthorization: vi.fn(),
};

// Create test app with mocked environment
function createTestApp(env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/oauth", oauthRoute);
  return app;
}

describe("oauth authorize routes", () => {
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

  describe("GET /oauth/authorize", () => {
    it("renders approval dialog HTML with state field", async () => {
      mockOAuthProvider.parseAuthRequest.mockResolvedValueOnce({
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
        state: "orig",
      });
      mockOAuthProvider.lookupClient.mockResolvedValueOnce({
        clientId: "test-client",
        clientName: "Test Client",
        redirectUris: ["https://example.com/callback"],
        tokenEndpointAuthMethod: "client_secret_basic",
      });

      const request = new Request("http://localhost/oauth/authorize", {
        method: "GET",
      });
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("<form");
      expect(html).toContain('name="state"');
    });
  });

  describe("POST /oauth/authorize", () => {
    beforeEach(() => {
      mockOAuthProvider.lookupClient.mockResolvedValue({
        clientId: "test-client",
        clientName: "Test Client",
        redirectUris: ["https://example.com/callback"],
        tokenEndpointAuthMethod: "client_secret_basic",
      });
    });
    it("should encode permissions in the redirect state", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read", "write"],
        state: "original-state",
      };
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo })));
      formData.append("permission", "issue_triage");
      formData.append("permission", "project_management");
      const request = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: formData,
      });
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);
      expect(redirectUrl.hostname).toBe("sentry.io");
      expect(redirectUrl.pathname).toBe("/oauth/authorize/");
      const stateParam = redirectUrl.searchParams.get("state");
      expect(stateParam).toBeTruthy();
      const decodedState = await verifyAndParseState(
        stateParam!,
        testEnv.COOKIE_SECRET as string,
      );
      expect((decodedState.req as any).permissions).toEqual([
        "issue_triage",
        "project_management",
      ]);
      expect((decodedState.req as any).clientId).toBe("test-client");
      expect((decodedState.req as any).redirectUri).toBe(
        "https://example.com/callback",
      );
      expect((decodedState.req as any).scope).toEqual(["read", "write"]);
    });

    it("should handle no permissions selected (read-only default)", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
        state: "original-state",
      };
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo })));
      const request = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: formData,
      });
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);
      const stateParam = redirectUrl.searchParams.get("state");
      const decodedState = await verifyAndParseState(
        stateParam!,
        testEnv.COOKIE_SECRET as string,
      );
      expect((decodedState.req as any).permissions).toEqual([]);
    });

    it("should handle only issue triage permission", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read", "write"],
        state: "original-state",
      };
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo })));
      formData.append("permission", "issue_triage");
      const request = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: formData,
      });
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      const redirectUrl = new URL(location!);
      const stateParam = redirectUrl.searchParams.get("state");
      const decodedState = await verifyAndParseState(
        stateParam!,
        testEnv.COOKIE_SECRET as string,
      );
      expect((decodedState.req as any).permissions).toEqual(["issue_triage"]);
    });

    it("should include Set-Cookie header for approval", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo })));
      const request = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: formData,
      });
      const response = await app.fetch(request, testEnv as Env);
      const setCookie = response.headers.get("Set-Cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("mcp-approved-clients=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Lax");
    });
  });

  describe("POST /oauth/authorize (CSRF/validation)", () => {
    it("should reject invalid encoded state (bad base64/json)", async () => {
      const formData = new FormData();
      formData.append("state", "%%%INVALID-BASE64%%%");
      const request = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: formData,
      });
      const response = await app.fetch(request, testEnv as Env);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe("Invalid request");
    });
  });
});
