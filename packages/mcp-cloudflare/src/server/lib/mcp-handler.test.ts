import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../types";

// Mock the agents/mcp module which has cloudflare: dependencies
vi.mock("agents/mcp", () => ({
  createMcpHandler: vi.fn(
    (server: { server: { setRequestHandler: () => void } }) => {
      // Return a handler that processes MCP requests through the server
      return async (request: Request) => {
        const body = (await request.json()) as {
          jsonrpc: string;
          method: string;
          params?: Record<string, unknown>;
          id: number | string;
        };

        // Simulate the MCP server behavior based on method
        if (body.method === "tools/list") {
          // Get tools from the actual server
          const tools = server.server._tools || [];
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: { tools },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (body.method === "initialize") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2024-11-05",
                serverInfo: { name: "sentry-mcp", version: "1.0.0" },
                capabilities: {},
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: "Method not found" },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      };
    },
  ),
}));

// Import after mocking
const { default: mcpHandler } = await import("./mcp-handler");

/**
 * Tests for the MCP handler.
 *
 * These tests exercise the MCP handler authentication and URL parsing.
 * MCP protocol tests verify the handler correctly integrates with the MCP server.
 */

/**
 * OAuth props that would be injected by the OAuth provider into ctx.props
 */
interface OAuthProps {
  id: string;
  clientId: string;
  accessToken: string;
  grantedSkills: string[];
}

/**
 * Default OAuth props for testing authenticated MCP requests
 */
const DEFAULT_OAUTH_PROPS: OAuthProps = {
  id: "test-user-123",
  clientId: "test-client",
  accessToken: "test-access-token",
  grantedSkills: ["inspect", "docs"],
};

/**
 * Create an ExecutionContext with OAuth props for testing the MCP handler.
 */
function createMcpContext(
  props: Partial<OAuthProps> = {},
): ExecutionContext & { props: OAuthProps } {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {
      ...DEFAULT_OAUTH_PROPS,
      ...props,
    },
  } as ExecutionContext & { props: OAuthProps };
}

/**
 * Create an MCP JSON-RPC request.
 */
function createMcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  options: {
    path?: string;
    id?: number | string;
  } = {},
): Request {
  const { path = "/mcp", id = 1 } = options;

  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.1",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id,
    }),
  });
}

/**
 * Create a mock Env for testing.
 */
function createTestEnv(): Env {
  return {
    COOKIE_SECRET: "test-cookie-secret-32-characters",
    SENTRY_CLIENT_ID: "test-client-id",
    SENTRY_CLIENT_SECRET: "test-client-secret",
    SENTRY_HOST: "sentry.io",
    OPENAI_API_KEY: "test-openai-key",
    OAUTH_KV: {} as KVNamespace,
    OAUTH_PROVIDER: {
      listUserGrants: vi.fn().mockResolvedValue({ items: [] }),
      revokeGrant: vi.fn().mockResolvedValue(undefined),
    } as unknown as Env["OAUTH_PROVIDER"],
  } as Env;
}

describe("MCP Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("authentication", () => {
    it("should reject requests without auth context", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = {
        waitUntil: () => {},
        passThroughOnException: () => {},
        // No props = no auth
      } as unknown as ExecutionContext;

      await expect(
        mcpHandler.fetch!(request, createTestEnv(), ctx),
      ).rejects.toThrow("No authentication context");
    });

    it("should reject legacy tokens without grantedSkills", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext({
        grantedSkills: undefined as unknown as string[],
      });
      // Simulate legacy token with grantedScopes but no grantedSkills
      (ctx.props as Record<string, unknown>).grantedScopes = [
        "org:read",
        "project:read",
      ];
      (ctx.props as Record<string, unknown>).grantedSkills = undefined;

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(401);
      expect(await response.text()).toContain("re-authorize");
      expect(response.headers.get("WWW-Authenticate")).toContain(
        "invalid_token",
      );
    });

    it("should reject tokens with no valid skills", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext({
        grantedSkills: [], // Empty skills
      });

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("No valid skills");
    });
  });

  describe("URL constraints", () => {
    it("should handle /mcp without constraints", async () => {
      const request = createMcpRequest("tools/list", {}, { path: "/mcp" });
      const ctx = createMcpContext();

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      // Should not fail on URL parsing (may fail later on constraints check)
      // but should get past the URL pattern matching
      expect(response.status).not.toBe(404);
    });

    it("should return 404 for invalid URL pattern", async () => {
      const request = new Request("http://localhost/invalid-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
      });
      const ctx = createMcpContext();

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(404);
    });
  });
});
