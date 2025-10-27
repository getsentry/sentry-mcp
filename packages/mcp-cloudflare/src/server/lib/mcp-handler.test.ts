import { describe, it, expect, vi, beforeEach } from "vitest";
import "urlpattern-polyfill";
import type { Env } from "../types";
import type { ExecutionContext } from "@cloudflare/workers-types";

// Mock the agents/mcp module
vi.mock("agents/mcp", () => ({
  experimental_createMcpHandler: vi.fn((server, config) => {
    // Return a mock handler that just echoes back the request info
    return async (request: Request, env: Env, ctx: ExecutionContext) => {
      return new Response(
        JSON.stringify({
          handler: "mcp",
          route: config.route,
          url: request.url,
        }),
        { status: 200 },
      );
    };
  }),
  getMcpAuthContext: vi.fn(() => ({
    props: {
      userId: "test-user-123",
      clientId: "test-client",
      accessToken: "test-token",
      grantedScopes: ["org:read", "project:read"],
      sentryHost: "sentry.io",
      mcpUrl: "https://test.mcp.sentry.io",
    },
  })),
}));

// Mock the MCP server configuration
vi.mock("@sentry/mcp-server/server", () => ({
  configureServer: vi.fn(async ({ getContext }) => {
    // Verify getContext is callable
    if (getContext) {
      getContext();
    }
  }),
}));

// Mock Sentry
vi.mock("@sentry/cloudflare", () => ({
  flush: vi.fn(),
}));

describe("mcp-handler", () => {
  let env: Env;
  let ctx: ExecutionContext;

  beforeEach(() => {
    env = {
      SENTRY_HOST: "sentry.io",
      COOKIE_SECRET: "test-secret",
    } as Env;

    ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;
  });

  describe("URL pattern parsing", () => {
    it("parses /mcp without constraints", async () => {
      const { default: handler } = await import("./mcp-handler");
      const request = new Request("https://test.mcp.sentry.io/mcp");

      const response = await handler.fetch!(request as any, env, ctx);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        handler: "mcp",
        route: "/mcp",
      });
    });

    it("parses /mcp/:org pattern", async () => {
      const { default: handler } = await import("./mcp-handler");
      const request = new Request(
        "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
      );

      const response = await handler.fetch!(request as any, env, ctx);

      expect(response.status).toBe(200);
    });

    it("parses /mcp/:org/:project pattern", async () => {
      const { default: handler } = await import("./mcp-handler");
      const request = new Request(
        "https://test.mcp.sentry.io/mcp/sentry-mcp-evals/cloudflare-mcp",
      );

      const response = await handler.fetch!(request as any, env, ctx);

      expect(response.status).toBe(200);
    });

    it("returns 404 for non-mcp paths", async () => {
      const { default: handler } = await import("./mcp-handler");
      const request = new Request("https://test.mcp.sentry.io/api/other");

      const response = await handler.fetch!(request as any, env, ctx);

      expect(response.status).toBe(404);
    });
  });

  describe("OAuth context retrieval", () => {
    it("returns 401 when no auth context is available", async () => {
      // Mock getMcpAuthContext to return undefined
      const { getMcpAuthContext } = await import("agents/mcp");
      vi.mocked(getMcpAuthContext).mockReturnValueOnce(undefined);

      const { default: handler } = await import("./mcp-handler");
      const request = new Request(
        "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
      );

      const response = await handler.fetch!(request as any, env, ctx);

      expect(response.status).toBe(401);
      expect(await response.text()).toContain("No authentication context");
    });

    it("returns 401 when auth context has no props", async () => {
      // Mock getMcpAuthContext to return context without props
      const { getMcpAuthContext } = await import("agents/mcp");
      vi.mocked(getMcpAuthContext).mockReturnValueOnce({} as any);

      const { default: handler } = await import("./mcp-handler");
      const request = new Request(
        "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
      );

      const response = await handler.fetch!(request as any, env, ctx);

      expect(response.status).toBe(401);
      expect(await response.text()).toContain("No authentication context");
    });
  });

  describe("AsyncLocalStorage constraint isolation", () => {
    it("isolates constraints between concurrent requests", async () => {
      const { constraintsStorage } = await import(
        "@sentry/mcp-server/internal/context-storage"
      );

      // Simulate concurrent requests with different constraints
      const results: string[] = [];

      const request1Promise = constraintsStorage.run(
        { organizationSlug: "org1", projectSlug: null, regionUrl: null },
        async () => {
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 10));
          const store = constraintsStorage.getStore();
          results.push(store?.organizationSlug || "none");
          return store?.organizationSlug;
        },
      );

      const request2Promise = constraintsStorage.run(
        { organizationSlug: "org2", projectSlug: null, regionUrl: null },
        async () => {
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 5));
          const store = constraintsStorage.getStore();
          results.push(store?.organizationSlug || "none");
          return store?.organizationSlug;
        },
      );

      const [result1, result2] = await Promise.all([
        request1Promise,
        request2Promise,
      ]);

      // Verify each context maintained its own constraints
      expect(result1).toBe("org1");
      expect(result2).toBe("org2");

      // Verify results array shows isolation (order may vary due to timing)
      expect(results).toContain("org1");
      expect(results).toContain("org2");
    });

    it("returns empty constraints when accessed outside of context", () => {
      const {
        constraintsStorage,
      } = require("@sentry/mcp-server/internal/context-storage");

      // Access outside of constraintsStorage.run()
      const store = constraintsStorage.getStore();

      expect(store).toBeUndefined();
    });

    it("properly scopes constraints within nested async operations", async () => {
      const { constraintsStorage } = await import(
        "@sentry/mcp-server/internal/context-storage"
      );

      const result = await constraintsStorage.run(
        {
          organizationSlug: "test-org",
          projectSlug: "test-project",
          regionUrl: "https://us.sentry.io",
        },
        async () => {
          // Simulate nested async operations (like API calls)
          const nestedResult = await (async () => {
            const store = constraintsStorage.getStore();
            return store?.projectSlug;
          })();

          return nestedResult;
        },
      );

      expect(result).toBe("test-project");
    });
  });

  describe("constraint verification integration", () => {
    it("verifies constraints before executing handler", async () => {
      // This test uses the real verifyConstraintsAccess which makes API calls
      const { default: handler } = await import("./mcp-handler");
      const request = new Request(
        "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
      );

      const response = await handler.fetch!(request as any, env, ctx);

      // Should succeed since we have valid org in mocks
      expect(response.status).toBe(200);
    });

    it("returns error when organization verification fails", async () => {
      const { default: handler } = await import("./mcp-handler");
      const request = new Request(
        "https://test.mcp.sentry.io/mcp/nonexistent-org",
      );

      const response = await handler.fetch!(request as any, env, ctx);

      // Should fail with 404
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("not found");
    });

    it("returns error when project verification fails", async () => {
      const { default: handler } = await import("./mcp-handler");
      const request = new Request(
        "https://test.mcp.sentry.io/mcp/sentry-mcp-evals/nonexistent-project",
      );

      const response = await handler.fetch!(request as any, env, ctx);

      // Should fail with 404
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("not found");
    });
  });

  describe("MCP handler invocation", () => {
    it("passes request to createMcpHandler with correct route", async () => {
      const { experimental_createMcpHandler } = await import("agents/mcp");
      const { default: handler } = await import("./mcp-handler");

      const request = new Request("https://test.mcp.sentry.io/mcp");
      await handler.fetch!(request as any, env, ctx);

      // Verify createMcpHandler was called with correct config
      expect(experimental_createMcpHandler).toHaveBeenCalledWith(
        expect.anything(), // server instance
        expect.objectContaining({
          route: "/mcp",
        }),
      );
    });

    it("executes handler within constraint context", async () => {
      const { constraintsStorage } = await import(
        "@sentry/mcp-server/internal/context-storage"
      );
      const { default: handler } = await import("./mcp-handler");

      // Create a spy to track when constraintsStorage.run is called
      const runSpy = vi.spyOn(constraintsStorage, "run");

      const request = new Request(
        "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
      );
      await handler.fetch!(request as any, env, ctx);

      // Verify constraintsStorage.run was called with the correct constraints
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationSlug: "sentry-mcp-evals",
          projectSlug: null,
          regionUrl: "https://us.sentry.io",
        }),
        expect.any(Function),
      );

      runSpy.mockRestore();
    });
  });
});
