import { describe, it, expect, vi, beforeEach } from "vitest";
import "urlpattern-polyfill";
import type { Env } from "../types";
import type { ExecutionContext } from "@cloudflare/workers-types";
import handler from "./mcp-handler.js";

// Mock Sentry to avoid actual telemetry
vi.mock("@sentry/cloudflare", () => ({
  flush: vi.fn(() => Promise.resolve(true)),
}));

// Mock agents/mcp since it's a third-party library
// We're not testing its behavior, just our integration with it
vi.mock("agents/mcp", () => ({
  experimental_createMcpHandler: vi.fn(() => {
    return vi.fn(() => new Response("MCP handler response", { status: 200 }));
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
        userId: "test-user-123",
        clientId: "test-client",
        accessToken: "test-token",
        grantedScopes: ["org:read", "project:read"],
        sentryHost: "sentry.io",
        mcpUrl: "https://test.mcp.sentry.io",
      },
    };
  });

  it("handles request with valid organization constraint", async () => {
    const request = new Request(
      "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
    );

    const response = await handler.fetch!(request as any, env, ctx);

    // Should succeed - verifies full flow:
    // 1. URL parsing extracts org constraint
    // 2. Auth extracted from ExecutionContext.props
    // 3. Constraint verification passes (MSW mocked API)
    // 4. ServerContext built and stored in AsyncLocalStorage
    // 5. MCP handler invoked successfully
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
});
