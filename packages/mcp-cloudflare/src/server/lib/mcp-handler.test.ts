import { describe, it, expect, vi, beforeEach } from "vitest";
import "urlpattern-polyfill";
import type { Env } from "../types";
import type { ExecutionContext } from "@cloudflare/workers-types";
import handler from "./mcp-handler.js";

// Mock Sentry to avoid actual telemetry
vi.mock("@sentry/cloudflare", () => ({
  flush: vi.fn(() => Promise.resolve(true)),
}));

// Mock the MCP handler creation - we're testing the wrapper logic, not the MCP protocol
vi.mock("agents/mcp", () => ({
  createMcpHandler: vi.fn(() => {
    return vi.fn(() => {
      return Promise.resolve(new Response("OK", { status: 200 }));
    });
  }),
}));

describe("mcp-handler", () => {
  let env: Env;
  let ctx: ExecutionContext & { props?: Record<string, unknown> };

  beforeEach(() => {
    vi.clearAllMocks();

    env = {
      SENTRY_HOST: "sentry.io",
      COOKIE_SECRET: "test-secret",
    } as Env;

    // ExecutionContext with OAuth props (set by OAuth provider)
    ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {
        id: "test-user-123",
        clientId: "test-client",
        accessToken: "test-token",
        grantedSkills: ["inspect", "docs"],
      },
    };
  });

  it("successfully handles request with org constraint", async () => {
    const request = new Request(
      "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
    );

    const response = await handler.fetch!(request as any, env, ctx);

    // Verify successful response
    expect(response.status).toBe(200);
  });

  it("returns 404 for invalid organization", async () => {
    const request = new Request(
      "https://test.mcp.sentry.io/mcp/nonexistent-org",
    );

    const response = await handler.fetch!(request as any, env, ctx);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("not found");
  });

  it("returns 404 for invalid project", async () => {
    const request = new Request(
      "https://test.mcp.sentry.io/mcp/sentry-mcp-evals/nonexistent-project",
    );

    const response = await handler.fetch!(request as any, env, ctx);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("not found");
  });

  it("returns error when authentication context is missing", async () => {
    const ctxWithoutAuth = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: undefined,
    };

    const request = new Request("https://test.mcp.sentry.io/mcp");

    await expect(
      handler.fetch!(request as any, env, ctxWithoutAuth as any),
    ).rejects.toThrow("No authentication context");
  });

  it("successfully handles request with org and project constraints", async () => {
    const request = new Request(
      "https://test.mcp.sentry.io/mcp/sentry-mcp-evals/cloudflare-mcp",
    );

    const response = await handler.fetch!(request as any, env, ctx);

    // Verify successful response
    expect(response.status).toBe(200);
  });

  it("successfully handles request without constraints", async () => {
    const request = new Request("https://test.mcp.sentry.io/mcp");

    const response = await handler.fetch!(request as any, env, ctx);

    // Verify successful response
    expect(response.status).toBe(200);
  });

  it("returns 401 and revokes grant for legacy tokens without grantedSkills", async () => {
    const legacyCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {
        id: "test-user-123",
        clientId: "test-client",
        accessToken: "test-token",
        // Legacy token: has grantedScopes but no grantedSkills
        grantedScopes: ["org:read", "project:read"],
      },
    };

    // Mock the OAuth provider for grant revocation
    const mockRevokeGrant = vi.fn();
    const mockListUserGrants = vi.fn().mockResolvedValue({
      items: [{ id: "grant-123", clientId: "test-client" }],
    });
    const envWithOAuth = {
      ...env,
      OAUTH_PROVIDER: {
        listUserGrants: mockListUserGrants,
        revokeGrant: mockRevokeGrant,
      },
    } as unknown as Env;

    const request = new Request("https://test.mcp.sentry.io/mcp");

    const response = await handler.fetch!(
      request as any,
      envWithOAuth,
      legacyCtx as any,
    );

    // Verify 401 response with re-auth message and WWW-Authenticate header
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("re-authorize");
    expect(response.headers.get("WWW-Authenticate")).toContain("invalid_token");

    // Verify waitUntil was called for background grant revocation
    expect(legacyCtx.waitUntil).toHaveBeenCalled();

    // Wait for the background task to complete
    const waitUntilPromise = legacyCtx.waitUntil.mock.calls[0][0];
    await waitUntilPromise;

    // Verify grant was looked up and revoked
    expect(mockListUserGrants).toHaveBeenCalledWith("test-user-123");
    expect(mockRevokeGrant).toHaveBeenCalledWith("grant-123", "test-user-123");
  });

  it("returns 400 when grantedSkills is empty array", async () => {
    const emptySkillsCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {
        id: "test-user-123",
        clientId: "test-client",
        accessToken: "test-token",
        grantedSkills: [], // Empty array - this is the suspected issue
      },
    };

    const request = new Request("https://test.mcp.sentry.io/mcp");

    const response = await handler.fetch!(
      request as any,
      env,
      emptySkillsCtx as any,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("No valid skills were granted");
  });

  it("returns 400 when grantedSkills contains only invalid skills", async () => {
    const invalidSkillsCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {
        id: "test-user-123",
        clientId: "test-client",
        accessToken: "test-token",
        grantedSkills: ["nonexistent-skill", "another-bad-skill"],
      },
    };

    const request = new Request("https://test.mcp.sentry.io/mcp");

    const response = await handler.fetch!(
      request as any,
      env,
      invalidSkillsCtx as any,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("No valid skills were granted");
  });
});
