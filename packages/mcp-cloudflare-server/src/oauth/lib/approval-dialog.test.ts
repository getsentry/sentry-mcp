import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderApprovalDialog, parseRedirectApproval } from "./approval-dialog";
import { signState } from "../state";

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

      // Step 1: Render the approval dialog
      const response = await renderApprovalDialog(
        new Request("https://example.com/oauth/authorize"),
        {
          client: mockClient,
          server: { name: "Sentry MCP" },
          state: { oauthReqInfo: originalOauthReqInfo },
          cookieSecret: TEST_SECRET,
        },
      );

      const html = await response.text();

      // Extract the signed state from the HTML form
      const stateMatch = html.match(/name="state" value="([^"]+)"/);
      expect(stateMatch).toBeTruthy();
      const signedState = stateMatch![1];

      // Step 2: Tamper with the state (try to change clientId)
      const [sig, b64] = signedState.split(".");
      const payload = JSON.parse(atob(b64));

      // Modify the clientId to a malicious one
      payload.req.oauthReqInfo.clientId = "evil-client";

      // Create tampered state with original signature (signature won't match)
      const tamperedState = `${sig}.${btoa(JSON.stringify(payload))}`;

      // Step 3: Try to submit the tampered form
      const formData = new FormData();
      formData.append("state", tamperedState);
      formData.append("skill", "inspect");

      const tamperedRequest = new Request(
        "https://example.com/oauth/authorize",
        {
          method: "POST",
          body: formData,
        },
      );

      // Should throw because signature verification fails
      await expect(
        parseRedirectApproval(tamperedRequest, TEST_SECRET),
      ).rejects.toThrow(/invalid signature|expired/i);
    });

    it("should reject expired state", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };

      // Create a state that's already expired (exp in the past)
      const now = Date.now();
      const expiredPayload = {
        req: { oauthReqInfo },
        iat: now - 15 * 60 * 1000, // 15 minutes ago
        exp: now - 5 * 60 * 1000, // Expired 5 minutes ago
      };

      const expiredState = await signState(expiredPayload, TEST_SECRET);

      // Try to submit with expired state
      const formData = new FormData();
      formData.append("state", expiredState);
      formData.append("skill", "inspect");

      const request = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      await expect(parseRedirectApproval(request, TEST_SECRET)).rejects.toThrow(
        /expired/i,
      );
    });

    it("should accept valid signed state", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };

      // Step 1: Render approval dialog to get valid signed state
      const response = await renderApprovalDialog(
        new Request("https://example.com/oauth/authorize"),
        {
          client: mockClient,
          server: { name: "Sentry MCP" },
          state: { oauthReqInfo },
          cookieSecret: TEST_SECRET,
        },
      );

      const html = await response.text();
      const stateMatch = html.match(/name="state" value="([^"]+)"/);
      const signedState = stateMatch![1];

      // Step 2: Submit valid form
      const formData = new FormData();
      formData.append("state", signedState);
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

    it("should reject state with wrong secret", async () => {
      const oauthReqInfo = {
        clientId: "test-client",
        redirectUri: "https://example.com/callback",
        scope: ["read"],
      };

      // Sign with one secret
      const response = await renderApprovalDialog(
        new Request("https://example.com/oauth/authorize"),
        {
          client: mockClient,
          server: { name: "Sentry MCP" },
          state: { oauthReqInfo },
          cookieSecret: "secret-1",
        },
      );

      const html = await response.text();
      const stateMatch = html.match(/name="state" value="([^"]+)"/);
      const signedState = stateMatch![1];

      // Try to verify with different secret
      const formData = new FormData();
      formData.append("state", signedState);
      formData.append("skill", "inspect");

      const request = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      await expect(parseRedirectApproval(request, "secret-2")).rejects.toThrow(
        /invalid signature/i,
      );
    });
  });
});
