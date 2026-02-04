import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the dependencies
vi.mock("./lib/mcp-handler", () => ({
  default: {
    fetch: vi.fn().mockResolvedValue(new Response("MCP response")),
  },
}));

vi.mock("./utils/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Import after mocks are set up
import serverExport from "./index";

describe("server entry point", () => {
  const mockEnv = {
    SENTRY_DSN: "https://test@sentry.io/123",
    CF_VERSION_METADATA: {
      id: "test-version-id",
    },
    OAUTH_KV: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    },
    MCP_RATE_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    },
    SENTRY_CLIENT_ID: "test-client-id",
    SENTRY_CLIENT_SECRET: "test-client-secret",
  };

  const mockCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CORS handling for public metadata endpoints", () => {
    it("should add CORS headers to /.well-known/ endpoints", async () => {
      const request = new Request(
        "https://mcp.sentry.dev/.well-known/oauth-authorization-server",
      );

      const response = await serverExport.fetch(
        request,
        mockEnv as any,
        mockCtx as any,
      );

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET, OPTIONS",
      );
    });

    it("should add CORS headers to /robots.txt", async () => {
      const request = new Request("https://mcp.sentry.dev/robots.txt");

      const response = await serverExport.fetch(
        request,
        mockEnv as any,
        mockCtx as any,
      );

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("should add CORS headers to /llms.txt", async () => {
      const request = new Request("https://mcp.sentry.dev/llms.txt");

      const response = await serverExport.fetch(
        request,
        mockEnv as any,
        mockCtx as any,
      );

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("should handle OPTIONS preflight for public metadata endpoints", async () => {
      const request = new Request(
        "https://mcp.sentry.dev/.well-known/oauth-authorization-server",
        { method: "OPTIONS" },
      );

      const response = await serverExport.fetch(
        request,
        mockEnv as any,
        mockCtx as any,
      );

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("should return 405 for OPTIONS on non-public endpoints", async () => {
      const request = new Request("https://mcp.sentry.dev/api/chat", {
        method: "OPTIONS",
      });

      const response = await serverExport.fetch(
        request,
        mockEnv as any,
        mockCtx as any,
      );

      expect(response.status).toBe(405);
    });
  });

  describe("OAuth metadata endpoint", () => {
    it("should return OAuth server metadata at /.well-known/oauth-authorization-server", async () => {
      const request = new Request(
        "https://mcp.sentry.dev/.well-known/oauth-authorization-server",
      );

      const response = await serverExport.fetch(
        request,
        mockEnv as any,
        mockCtx as any,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("issuer");
      expect(body).toHaveProperty("authorization_endpoint");
      expect(body).toHaveProperty("token_endpoint");
    });
  });

  describe("MCP endpoint authentication", () => {
    it("should require authentication for /mcp endpoint", async () => {
      const request = new Request("https://mcp.sentry.dev/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
      });

      const response = await serverExport.fetch(
        request,
        mockEnv as any,
        mockCtx as any,
      );

      // Should return 401 without Authorization header
      expect(response.status).toBe(401);
    });

    it("should require authentication for /mcp/* endpoints", async () => {
      const request = new Request("https://mcp.sentry.dev/mcp/sentry/project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
      });

      const response = await serverExport.fetch(
        request,
        mockEnv as any,
        mockCtx as any,
      );

      // Should return 401 without Authorization header
      expect(response.status).toBe(401);
    });
  });
});
