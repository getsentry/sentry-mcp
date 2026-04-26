import type { ExecutionContext, RateLimit } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import mcpHandler from "./mcp-handler";

interface OAuthProps {
  id: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  grantedSkills: string[];
  constraintOrganizationSlug?: string | null;
  constraintProjectSlug?: string | null;
}

const DEFAULT_OAUTH_PROPS: OAuthProps = {
  id: "test-user-123",
  clientId: "test-client",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  grantedSkills: ["inspect", "docs"],
};

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

function createMcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  options: {
    path?: string;
    id?: number | string;
    bearerToken?: string;
  } = {},
): Request {
  const { path = "/mcp", id = 1, bearerToken } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "CF-Connecting-IP": "192.0.2.1",
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id,
    }),
  });
}

async function parseSSEResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`No data line found in SSE response: ${text}`);
  }
  return JSON.parse(dataLine.slice(6)) as T;
}

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
      } as ExecutionContext;

      await expect(
        mcpHandler.fetch!(request, createTestEnv(), ctx),
      ).rejects.toThrow("No authentication context");
    });

    it("should reject legacy tokens without grantedSkills", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext({
        grantedSkills: undefined as unknown as string[],
      });
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

    it("should revoke and reject stale grants missing a refresh token", async () => {
      const request = createMcpRequest(
        "tools/list",
        {},
        {
          bearerToken: "test-user-123:specific-grant-id:secret",
        },
      );
      const ctx = createMcpContext({
        refreshToken: undefined as unknown as string,
      });
      const env = createTestEnv();

      const response = await mcpHandler.fetch!(request, env, ctx);

      expect(response.status).toBe(401);
      expect(await response.text()).toContain("re-authorize");
      expect(response.headers.get("WWW-Authenticate")).toContain(
        "invalid_token",
      );
      expect(ctx.waitUntil).toHaveBeenCalled();

      // Drive the scheduled revoke task and confirm we revoke the exact
      // grant from the bearer token, not whatever listUserGrants returns.
      await (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(env.OAUTH_PROVIDER.revokeGrant).toHaveBeenCalledTimes(1);
      expect(env.OAUTH_PROVIDER.revokeGrant).toHaveBeenCalledWith(
        "specific-grant-id",
        "test-user-123",
      );
      expect(env.OAUTH_PROVIDER.listUserGrants).not.toHaveBeenCalled();
    });

    it("targets the exact grant when multiple grants exist for the same client", async () => {
      // Simulate the multi-session case enabled by `revokeExistingGrants:false`:
      // listUserGrants would return another active session's grant first, but
      // the request's own bearer-token grant is what should be revoked.
      const request = createMcpRequest(
        "tools/list",
        {},
        {
          bearerToken: "test-user-123:request-specific-grant:secret",
        },
      );
      const ctx = createMcpContext({
        refreshToken: undefined as unknown as string,
      });
      const env = createTestEnv();
      (
        env.OAUTH_PROVIDER.listUserGrants as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        items: [
          { id: "other-active-session-grant", clientId: "test-client" },
          { id: "request-specific-grant", clientId: "test-client" },
        ],
      });

      await mcpHandler.fetch!(request, env, ctx);
      await (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

      expect(env.OAUTH_PROVIDER.revokeGrant).toHaveBeenCalledExactlyOnceWith(
        "request-specific-grant",
        "test-user-123",
      );
    });

    it("skips revoke when bearer token is missing or malformed", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext({
        refreshToken: undefined as unknown as string,
      });
      const env = createTestEnv();

      const response = await mcpHandler.fetch!(request, env, ctx);
      await (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

      expect(response.status).toBe(401);
      // No grantId means we can't safely target a specific grant. Return
      // the 401 but skip the KV revoke rather than risk killing another
      // session via a clientId-based fallback.
      expect(env.OAUTH_PROVIDER.revokeGrant).not.toHaveBeenCalled();
    });

    it("should reject tokens with no valid skills", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext({ grantedSkills: [] });

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("No valid skills");
    });

    it("applies the authenticated MCP rate limit per user", async () => {
      const mockUserRateLimiter = {
        limit: vi.fn().mockResolvedValue({ success: true }),
      } as unknown as RateLimit;
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext();
      const env = createTestEnv();
      env.MCP_USER_RATE_LIMITER = mockUserRateLimiter;

      const response = await mcpHandler.fetch!(request, env, ctx);

      expect(response.status).toBe(200);
      expect(mockUserRateLimiter.limit).toHaveBeenCalledWith({
        key: expect.stringMatching(/^mcp:user:[0-9a-f]{16}$/),
      });
    });

    it("returns 429 when the authenticated user exceeds the MCP rate limit", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext();
      const env = createTestEnv();
      env.MCP_USER_RATE_LIMITER = {
        limit: vi.fn().mockResolvedValue({ success: false }),
      } as unknown as RateLimit;

      const response = await mcpHandler.fetch!(request, env, ctx);

      expect(response.status).toBe(429);
      expect(await response.text()).toContain("Rate limit exceeded");
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

    it("returns 403 when the token is org-scoped but the MCP URL uses a different organization", async () => {
      const request = createMcpRequest(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
        { path: "/mcp/other-org" },
      );
      const ctx = createMcpContext({
        constraintOrganizationSlug: "my-org",
      });

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("scoped to an organization");
    });

    it("returns 403 when the token is project-scoped but the MCP URL uses a different project", async () => {
      const request = createMcpRequest(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
        { path: "/mcp/my-org/wrong-project" },
      );
      const ctx = createMcpContext({
        constraintOrganizationSlug: "my-org",
        constraintProjectSlug: "expected-project",
      });

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("scoped to a project");
    });

    it("returns 403 when the token is project-scoped but the MCP URL omits the project segment", async () => {
      const request = createMcpRequest(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
        { path: "/mcp/my-org" },
      );
      const ctx = createMcpContext({
        constraintOrganizationSlug: "my-org",
        constraintProjectSlug: "my-project",
      });

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("scoped to a project");
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
      expect(body.result?.tools.length).toBeGreaterThan(0);
    });

    it("should filter tools based on granted skills", async () => {
      const request = createMcpRequest("tools/list");
      const ctx = createMcpContext({ grantedSkills: ["docs"] });

      const response = await mcpHandler.fetch!(request, createTestEnv(), ctx);

      expect(response.status).toBe(200);
      const body = await parseSSEResponse<{
        result?: { tools: Array<{ name: string }> };
      }>(response);
      const toolNames = body.result?.tools.map((tool) => tool.name) ?? [];

      expect(toolNames).toContain("search_docs");
      expect(toolNames).not.toContain("get_issue_details");
    });
  });
});
