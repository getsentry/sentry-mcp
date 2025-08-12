import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderApprovalDialog, parseRedirectApproval } from "./approval-dialog";

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

      // Check that script tags are escaped
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("parseRedirectApproval", () => {
    it("should parse state and generate approval cookie", async () => {
      const formData = new FormData();
      formData.append(
        "state",
        btoa(JSON.stringify({ oauthReqInfo: { clientId: "test-client" } })),
      );

      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      const result = await parseRedirectApproval(mockRequest, "test-secret");

      expect(result.state).toEqual({
        oauthReqInfo: { clientId: "test-client" },
      });
      expect(result.headers["Set-Cookie"]).toContain("mcp-approved-clients=");
    });

    it("should reject non-POST requests", async () => {
      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "GET",
      });

      await expect(
        parseRedirectApproval(mockRequest, "test-secret"),
      ).rejects.toThrow("Invalid request method. Expected POST.");
    });

    it("should reject requests without state", async () => {
      const formData = new FormData();
      // Missing state

      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
      });

      await expect(
        parseRedirectApproval(mockRequest, "test-secret"),
      ).rejects.toThrow("Missing or invalid 'state' in form data.");
    });
  });
});
