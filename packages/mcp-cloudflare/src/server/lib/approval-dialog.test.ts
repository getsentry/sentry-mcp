import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderApprovalDialog, parseRedirectApproval } from "./approval-dialog";

// Mock crypto.getRandomValues for consistent testing
const mockGetRandomValues = vi.fn();
Object.defineProperty(global, "crypto", {
  value: {
    getRandomValues: mockGetRandomValues,
    subtle: {
      importKey: vi.fn(),
      sign: vi.fn(),
      verify: vi.fn(),
    },
  },
  writable: true,
});

describe("approval-dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock crypto.getRandomValues to return predictable values for testing
    mockGetRandomValues.mockReturnValue(new Uint8Array(16).fill(1));
    // Mock Date.now to return a predictable timestamp
    vi.spyOn(Date, 'now').mockReturnValue(1000000000000); // Fixed timestamp for testing
  });

  describe("renderApprovalDialog", () => {
    it("should generate CSRF token and include it in the form", async () => {
      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "GET",
      });

      const options = {
        client: {
          clientId: "test-client-id",
          clientName: "Test Client",
        },
        server: {
          name: "Test Server",
        },
        state: { test: "data" },
      };

      const response = await renderApprovalDialog(mockRequest, options);
      const html = await response.text();

      // Check that CSRF token is included in the form
      expect(html).toContain('name="csrf_token"');
      // Token format: 8 chars timestamp + 24 chars random (all 1s from our mock)
      expect(html).toContain('value="3b9aca00111111111111111111111111"'); // Based on our mock

      // Check that Set-Cookie header is set for CSRF token
      const setCookieHeader = response.headers.get("Set-Cookie");
      expect(setCookieHeader).toContain("mcp-csrf-token=");
      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("Secure");
      expect(setCookieHeader).toContain("SameSite=Strict");
    });

    it("should include state in the form", async () => {
      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "GET",
      });

      const options = {
        client: {
          clientId: "test-client-id",
          clientName: "Test Client",
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
    it("should reject requests without CSRF token", async () => {
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo: { clientId: "test-client" } })));
      // Missing CSRF token

      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
        headers: {
          Cookie: "mcp-csrf-token=3b9aca00111111111111111111111111",
        },
      });

      await expect(parseRedirectApproval(mockRequest, "test-secret")).rejects.toThrow(
        "Missing or invalid CSRF token in form data."
      );
    });

    it("should reject requests with invalid CSRF token", async () => {
      const formData = new FormData();
      formData.append("state", btoa(JSON.stringify({ oauthReqInfo: { clientId: "test-client" } })));
      formData.append("csrf_token", "invalid-token");

      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
        headers: {
          Cookie: "mcp-csrf-token=3b9aca00111111111111111111111111",
        },
      });

      await expect(parseRedirectApproval(mockRequest, "test-secret")).rejects.toThrow(
        "Invalid CSRF token. Request may be forged."
      );
    });

    it("should reject non-POST requests", async () => {
      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "GET",
      });

      await expect(parseRedirectApproval(mockRequest, "test-secret")).rejects.toThrow(
        "Invalid request method. Expected POST."
      );
    });

    it("should reject requests without state", async () => {
      const formData = new FormData();
      formData.append("csrf_token", "3b9aca00111111111111111111111111");
      // Missing state

      const mockRequest = new Request("https://example.com/oauth/authorize", {
        method: "POST",
        body: formData,
        headers: {
          Cookie: "mcp-csrf-token=3b9aca00111111111111111111111111",
        },
      });

      await expect(parseRedirectApproval(mockRequest, "test-secret")).rejects.toThrow(
        "Missing or invalid 'state' in form data."
      );
    });
  });
});
