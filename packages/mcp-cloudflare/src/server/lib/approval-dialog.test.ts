import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderApprovalDialog } from "./approval-dialog";

describe("approval-dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("renderApprovalDialog", () => {
    it("should include state in the form", async () => {
      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "GET",
      });

      const options = {
        client: {
          clientId: "test-client-id",
          clientName: "Test Client",
          redirectUris: ["https://example.com/callback"],
          tokenEndpointAuthMethod: "client_secret_basic",
        },
        server: {
          name: "Test Server",
        },
        state: { oauthReqInfo: { clientId: "test-client" } },
      };

      const response = await renderApprovalDialog(mockRequest, options);
      const html = await response.text();

      // Check that state is included in the form
      expect(html).toContain('name="state"');
      expect(html).toContain('value="');
    });

    it("should sanitize HTML content", async () => {
      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "GET",
      });

      const options = {
        client: {
          clientId: "test-client-id",
          clientName: "<script>alert('xss')</script>",
          redirectUris: ["https://example.com/callback"],
          tokenEndpointAuthMethod: "client_secret_basic",
        },
        server: {
          name: "Test Server",
        },
        state: { test: "data" },
      };

      const response = await renderApprovalDialog(mockRequest, options);
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

  // parseRedirectApproval behavior (form parsing, cookies, permissions) is
  // validated at the route level in sentry-oauth.test.ts to keep concerns
  // consolidated around HTTP behavior. This test file focuses on pure
  // rendering concerns of the dialog itself.
});
