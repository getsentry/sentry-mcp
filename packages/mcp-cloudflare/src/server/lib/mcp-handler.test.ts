import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../types";
import mcpHandler from "./mcp-handler";

/**
 * Tests for the MCP handler.
 *
 * These tests exercise the MCP handler authentication, URL parsing,
 * and integration with the MCP server.
 *
 * Note: fetchMock is set up globally in test-setup.ts with persistent interceptors
 * for Sentry API endpoints. Tests here add specific interceptors as needed.
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
 *
 * Note: The MCP handler requires Accept header to include both
 * application/json and text/event-stream for streaming responses.
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
      Accept: "application/json, text/event-stream",
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
 * Parse an SSE response to extract JSON-RPC response.
 * SSE format: "event: message\ndata: {...JSON...}\n\n"
 */
async function parseSSEResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  // Extract JSON from "data: {...}" line
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`No data line found in SSE response: ${text}`);
  }
  return JSON.parse(dataLine.slice(6)) as T;
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

  // Note: fetchMock lifecycle is managed by test-setup.ts

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
      const request = createMcpRequest(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
        { path: "/mcp" },
      );
      const ctx = createMcpContext();

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(200);
      const body = await parseSSEResponse<{
        result?: { protocolVersion: string };
      }>(response);
      expect(body.result?.protocolVersion).toBeDefined();
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

    it("should handle /mcp/:org with valid organization", async () => {
      // Uses global mock for sentry-mcp-evals organization
      const request = createMcpRequest(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
        { path: "/mcp/sentry-mcp-evals" },
      );
      const ctx = createMcpContext();

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(200);
      const body = await parseSSEResponse<{
        result?: { protocolVersion: string };
      }>(response);
      expect(body.result?.protocolVersion).toBeDefined();
    });

    it("should return 404 for non-existent organization", async () => {
      // Uses global mock for nonexistent-org (returns 404)
      const request = createMcpRequest(
        "initialize",
        {},
        { path: "/mcp/nonexistent-org" },
      );
      const ctx = createMcpContext();

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(404);
      expect(await response.text()).toContain("not found");
    });
  });

  describe("MCP protocol", () => {
    it("should respond to tools/list with available tools", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext();

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(200);
      const body = await parseSSEResponse<{
        result?: { tools: Array<{ name: string }> };
      }>(response);
      expect(body.result?.tools).toBeDefined();
      expect(Array.isArray(body.result?.tools)).toBe(true);
      // Should have tools based on granted skills (inspect, docs)
      expect(body.result?.tools.length).toBeGreaterThan(0);
    });

    it("should filter tools based on granted skills", async () => {
      const request = createMcpRequest("tools/list");
      // Only grant "docs" skill
      const ctx = createMcpContext({ grantedSkills: ["docs"] });

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(200);
      const body = await parseSSEResponse<{
        result?: { tools: Array<{ name: string }> };
      }>(response);
      const toolNames = body.result?.tools.map((t) => t.name) || [];

      // Should have docs tools
      expect(toolNames).toContain("search_docs");

      // Should NOT have inspect-only tools
      expect(toolNames).not.toContain("get_issue_details");
    });
  });
});
