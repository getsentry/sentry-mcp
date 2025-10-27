import { describe, it, expect, vi, beforeEach } from "vitest";
import "urlpattern-polyfill";
import type { Env } from "../types";
import type { ExecutionContext } from "@cloudflare/workers-types";
import handler from "./mcp-handler.js";
import { serverContextStorage } from "@sentry/mcp-server/internal/context-storage";

// Mock Sentry to avoid actual telemetry
vi.mock("@sentry/cloudflare", () => ({
  flush: vi.fn(() => Promise.resolve(true)),
}));

// Mock the MCP handler creation - we're testing the wrapper logic, not the MCP protocol
vi.mock("agents/mcp", () => ({
  experimental_createMcpHandler: vi.fn(() => {
    return vi.fn(() => Promise.resolve(new Response("OK", { status: 200 })));
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
        grantedScopes: ["org:read", "project:read"],
      },
    };
  });

  it("builds ServerContext with auth props and verified constraints", async () => {
    const request = new Request(
      "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
    );

    // Capture the ServerContext that was set
    let capturedContext: any = null;
    const originalRun = serverContextStorage.run.bind(serverContextStorage);
    vi.spyOn(serverContextStorage, "run").mockImplementation((context, fn) => {
      capturedContext = context;
      return originalRun(context, fn);
    });

    await handler.fetch!(request as any, env, ctx);

    // Verify ServerContext was built correctly
    expect(capturedContext).toMatchObject({
      userId: "test-user-123",
      clientId: "test-client",
      accessToken: "test-token",
      sentryHost: "sentry.io",
      constraints: {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: null,
        regionUrl: "https://us.sentry.io",
      },
    });
    expect(capturedContext.grantedScopes).toBeDefined();
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

  it("parses URL constraints correctly for org-only", async () => {
    let capturedContext: any = null;
    const originalRun = serverContextStorage.run.bind(serverContextStorage);
    vi.spyOn(serverContextStorage, "run").mockImplementation((context, fn) => {
      capturedContext = context;
      return originalRun(context, fn);
    });

    const request = new Request(
      "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
    );
    await handler.fetch!(request as any, env, ctx);

    expect(capturedContext.constraints).toMatchObject({
      organizationSlug: "sentry-mcp-evals",
      projectSlug: null,
    });
  });

  it("parses URL constraints correctly for org and project", async () => {
    let capturedContext: any = null;
    const originalRun = serverContextStorage.run.bind(serverContextStorage);
    vi.spyOn(serverContextStorage, "run").mockImplementation((context, fn) => {
      capturedContext = context;
      return originalRun(context, fn);
    });

    const request = new Request(
      "https://test.mcp.sentry.io/mcp/sentry-mcp-evals/cloudflare-mcp",
    );
    await handler.fetch!(request as any, env, ctx);

    expect(capturedContext.constraints).toMatchObject({
      organizationSlug: "sentry-mcp-evals",
      projectSlug: "cloudflare-mcp",
    });
  });
});
