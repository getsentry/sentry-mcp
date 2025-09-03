import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import sentryOauthRoute from "../sentry-oauth";
import type { Env } from "../types";

// Mock the OAuth provider
const mockOAuthProvider = {
  parseAuthRequest: vi.fn(),
  lookupClient: vi.fn(),
  completeAuthorization: vi.fn(),
};

// Create test app with mocked environment
function createTestApp(env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/oauth", sentryOauthRoute);

  return app;
}

describe("sentry-oauth route", () => {
  let app: ReturnType<typeof createTestApp>;
  let testEnv: Partial<Env>;

  beforeEach(() => {
    vi.clearAllMocks();

    testEnv = {
      OAUTH_PROVIDER: mockOAuthProvider as any,
      COOKIE_SECRET: "test-secret-key",
      SENTRY_CLIENT_ID: "test-client-id",
      SENTRY_CLIENT_SECRET: "test-client-secret",
      SENTRY_HOST: "sentry.io",
    };

    app = createTestApp(testEnv);
  });

  describe("GET /oauth/authorize", () => {
    it("renders approval dialog HTML with state field", async () => {
      // Mock the OAuth request parsed from the provider
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
      // Basic structure checks come from the renderer
      expect(html).toContain("<form");
      expect(html).toContain('name="state"');
    });
  });

  describe("POST /oauth/authorize", () => {
    it("should encode permissions in the redirect state", async () => {
      // Setup the OAuth request info that would come from the approval dialog
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read", "write"],
        state: "original-state",
      };

      // Create FormData (like a real form submission)
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo })));
      formData.append("permission", "issue_triage");
      formData.append("permission", "project_management");

      const request = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      const response = await app.fetch(request, testEnv as Env);

      // Should redirect to Sentry OAuth
      expect(response.status).toBe(302);

      // Get the redirect location
      const location = response.headers.get("location");
      expect(location).toBeTruthy();

      // Parse the redirect URL
      const redirectUrl = new URL(location!);
      expect(redirectUrl.hostname).toBe("sentry.io");
      expect(redirectUrl.pathname).toBe("/oauth/authorize/");

      // Decode the state parameter
      const stateParam = redirectUrl.searchParams.get("state");
      expect(stateParam).toBeTruthy();

      const decodedState = JSON.parse(atob(stateParam!));

      // Verify permissions are included in the state
      expect(decodedState.permissions).toEqual([
        "issue_triage",
        "project_management",
      ]);

      // Verify original OAuth info is preserved
      expect(decodedState.clientId).toBe("test-client");
      expect(decodedState.redirectUri).toBe("https://example.com/callback");
      expect(decodedState.scope).toEqual(["read", "write"]);
    });

    it("should handle no permissions selected (read-only default)", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
        state: "original-state",
      };

      // Create FormData with state but no permission checkboxes
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo })));

      const request = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      const response = await app.fetch(request, testEnv as Env);

      // Should redirect to Sentry OAuth
      expect(response.status).toBe(302);

      // Get the redirect location
      const location = response.headers.get("location");
      expect(location).toBeTruthy();

      // Parse the state parameter
      const redirectUrl = new URL(location!);
      const stateParam = redirectUrl.searchParams.get("state");
      const decodedState = JSON.parse(atob(stateParam!));

      // Verify permissions default to empty array when not selected
      expect(decodedState.permissions).toEqual([]);
    });

    it("should handle only issue triage permission", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read", "write"],
        state: "original-state",
      };

      // Create FormData with state and only issue triage permission
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo })));
      formData.append("permission", "issue_triage");

      const request = new Request("http://localhost/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      const response = await app.fetch(request, testEnv as Env);

      // Should redirect to Sentry OAuth
      expect(response.status).toBe(302);

      // Parse the state parameter
      const location = response.headers.get("location");
      const redirectUrl = new URL(location!);
      const stateParam = redirectUrl.searchParams.get("state");
      const decodedState = JSON.parse(atob(stateParam!));

      // Verify only issue triage is selected
      expect(decodedState.permissions).toEqual(["issue_triage"]);
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

      // Should include Set-Cookie header for client approval
      const setCookie = response.headers.get("Set-Cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("mcp-approved-clients=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Lax");
    });

    it("should reject request without state", async () => {
      const formData = new FormData();
      // No state field

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

  describe("GET /oauth/callback", () => {
    it("should reject callback with invalid state param", async () => {
      // Provide a non-base64/invalid state to simulate tampering/CSRF
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

      // Create callback request without the approval cookie
      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${btoa(JSON.stringify(oauthReqInfo))}`,
        {
          method: "GET",
          headers: {
            // No cookie header
          },
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

      // Create callback request with an invalid/tampered cookie
      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${btoa(JSON.stringify(oauthReqInfo))}`,
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

      // First, create a valid approval cookie for a different client
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

      // Now try to use that cookie for a different client
      const request = new Request(
        `http://localhost/oauth/callback?code=test-code&state=${btoa(JSON.stringify(oauthReqInfo))}`,
        {
          method: "GET",
          headers: {
            Cookie: setCookie!.split(";")[0], // Extract just the cookie value
          },
        },
      );

      const response = await app.fetch(request, testEnv as Env);

      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).toBe("Authorization failed: Client not approved");
    });
  });

  describe("POST /oauth/authorize (CSRF/validation)", () => {
    it("should reject invalid encoded state (bad base64/json)", async () => {
      const formData = new FormData();
      // Intentionally malformed state
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
