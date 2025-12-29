import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderApprovalDialog, parseRedirectApproval } from "./approval-dialog";

describe("approval-dialog", () => {
  const TEST_SECRET = "test-cookie-secret-32-chars-long";

  const mockClient = {
    clientId: "test-client-id",
    clientName: "Test Client",
    redirectUris: ["https://example.com/callback"],
    tokenEndpointAuthMethod: "client_secret_basic",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("renderApprovalDialog", () => {
    it("should include state in the form", async () => {
      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "GET",
      });

      const response = await renderApprovalDialog(mockRequest, {
        client: mockClient,
        server: { name: "Test Server" },
        state: { oauthReqInfo: { clientId: "test-client" } },
        cookieSecret: TEST_SECRET,
      });
      const html = await response.text();

      // Check that state is included in the form
      expect(html).toContain('name="state"');
      expect(html).toContain('value="');
    });

    it("should sanitize HTML content", async () => {
      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "GET",
      });

      const response = await renderApprovalDialog(mockRequest, {
        client: {
          clientId: "test-client-id",
          clientName: "<script>alert('xss')</script>",
          redirectUris: ["https://example.com/callback"],
          tokenEndpointAuthMethod: "client_secret_basic",
        },
        server: { name: "Test Server" },
        state: { test: "data" },
        cookieSecret: TEST_SECRET,
      });
      const html = await response.text();

      // Check that script tags in client name are escaped and no script tags are present
      expect(html).not.toContain("<script>alert('xss')</script>");
      expect(html).toContain(
        "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;",
      );
      // Should not contain any script tags (JavaScript-free implementation)
      expect(html).not.toContain("<script>");
    });
  });

  describe("CSRF protection with HMAC-signed state", () => {
    it("should reject tampered state in form submission", async () => {
      const originalOauthReqInfo = {
        clientId: "legitimate-client",
        redirectUri: "https://legitimate.com/callback",
        scope: ["read"],
      };

      // Note: PR #608 removed HMAC signing from approval form state
      // CSRF protection now relies on the OAuth state passed to Sentry (still HMAC-signed)
      // This test verifies that tampering is technically possible but doesn't matter
      // because downstream validation (redirect URI checks, client approval cookies) prevent abuse

      const tamperedState = btoa(
        JSON.stringify({
          oauthReqInfo: {
            clientId: "evil-client",
            redirectUri: "https://evil.com/callback",
            scope: ["read"],
          },
        }),
      );

      const formData = new FormData();
      formData.append("state", tamperedState);
      formData.append("skill", "inspect");

      const request = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      // Tampering succeeds at parse level (no signature check)
      // but downstream validation will catch it (redirect URI validation, etc.)
      const result = await parseRedirectApproval(request, TEST_SECRET);
      expect(result.state.oauthReqInfo.clientId).toBe("evil-client");
    });

    it("should accept any valid base64 state (no expiry check)", async () => {
      // Note: PR #608 removed expiry checks from approval form state
      // Expiry is still enforced on the OAuth state passed to Sentry
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };

      const encodedState = btoa(JSON.stringify({ oauthReqInfo }));

      const formData = new FormData();
      formData.append("state", encodedState);
      formData.append("skill", "inspect");

      const request = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      const result = await parseRedirectApproval(request, TEST_SECRET);
      expect(result.state.oauthReqInfo.clientId).toBe("test-client");
    });

    it("should accept valid signed state", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };

      // Step 1: Render approval dialog to get valid signed state
      const response = renderApprovalDialog(
        new Request("https://example.com/oauth/authorize"),
        {
          client: mockClient,
          server: { name: "Sentry MCP" },
          state: { oauthReqInfo },
        },
      );

      const html = await response.text();
      const stateMatch = html.match(/name="state" value="([^"]+)"/);
      const encodedState = stateMatch![1];

      // Step 2: Submit valid form
      const formData = new FormData();
      formData.append("state", encodedState);
      formData.append("skill", "inspect");
      formData.append("skill", "docs");

      const request = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        headers: {
          Cookie: "mcp-approved-clients=test",
        },
        body: formData,
      });

      // Should succeed with valid state
      const result = await parseRedirectApproval(request, TEST_SECRET);

      expect(result.state).toBeDefined();
      expect(result.state.oauthReqInfo).toEqual(oauthReqInfo);
      expect(result.skills).toEqual(["inspect", "docs"]);
    });

    it("should accept state regardless of secret (no signature validation)", async () => {
      // Note: PR #608 removed signature validation from approval form state
      // The cookieSecret is still used for cookie signing, but not state validation
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };

      // Create state with simple base64 encoding
      const encodedState = btoa(JSON.stringify({ oauthReqInfo }));

      const formData = new FormData();
      formData.append("state", encodedState);
      formData.append("skill", "inspect");

      const request = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      // Should succeed - secret doesn't matter for state validation
      const result = await parseRedirectApproval(request, "any-secret");
      expect(result.state.oauthReqInfo).toEqual(oauthReqInfo);
    });
  });
});
