import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "../types";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";

// Mock Sentry
vi.mock("@sentry/cloudflare", () => ({
  withSentry: (config: any, handler: any) => handler,
  instrumentDurableObjectWithSentry: (config: any, cls: any) => cls,
}));

// Mock the sentry config
vi.mock("../sentry.config", () => ({
  default: {
    partial: () => ({}),
  },
}));

// Mock the app module
vi.mock("../app", () => ({
  default: {
    fetch: async (request: Request, env: any, ctx: any) => {
      return new Response("App handler", { status: 404 });
    },
  },
}));

// Mock the agents/mcp module - just enough to verify endpoints are accessible
vi.mock("agents/mcp", () => {
  const McpAgent = {
    serve(path: string) {
      return {
        async fetch(request: Request, env: any, ctx: any): Promise<Response> {
          const url = new URL(request.url);
          if (url.pathname.startsWith(path)) {
            return new Response("MCP endpoint active", { status: 200 });
          }
          return new Response("Not found", { status: 404 });
        },
      };
    },

    serveSSE(path: string) {
      return {
        async fetch(request: Request, env: any, ctx: any): Promise<Response> {
          const url = new URL(request.url);
          if (url.pathname.startsWith(path)) {
            // Return a minimal SSE response
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(`event: endpoint\ndata: ${path}/message\n\n`),
                );
              },
            });

            return new Response(stream, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              },
            });
          }
          return new Response("Not found", { status: 404 });
        },
      };
    },
  };

  return { McpAgent };
});

// Mock the OAuth provider
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  default: class OAuthProvider {
    constructor(config: any) {
      this.config = config;
    }

    config: any;

    async fetch(request: Request, env: any, ctx: any): Promise<Response> {
      return (
        this.handle(request, env, ctx) ||
        new Response("Not found", { status: 404 })
      );
    }

    async handle(
      request: Request,
      env: any,
      ctx: any,
    ): Promise<Response | null> {
      const url = new URL(request.url);

      // Check API handlers
      for (const [path, handler] of Object.entries(
        this.config.apiHandlers || {},
      )) {
        if (url.pathname.startsWith(path)) {
          return handler.fetch(request, env, ctx);
        }
      }

      // OAuth endpoints
      if (url.pathname.startsWith("/oauth")) {
        return new Response("OAuth endpoint", { status: 200 });
      }

      // Pass to default handler if provided
      if (this.config.defaultHandler) {
        return this.config.defaultHandler.fetch(request, env, ctx);
      }

      return null;
    }
  },
}));

describe("MCP endpoints - basic connectivity", () => {
  let mockEnv: Env;
  let mockCtx: any;

  beforeEach(() => {
    mockEnv = {
      MCP_OBJECT: {} as DurableObjectNamespace,
      SENTRY_HOST: "sentry.io",
    } as Env;

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("/mcp endpoint", () => {
    it("should respond to /mcp", async () => {
      const { default: worker } = await import("../index");

      const request = new Request("http://test.workers.dev/mcp");
      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("MCP endpoint active");
    });

    it("should respond to /mcp with trailing slash", async () => {
      const { default: worker } = await import("../index");

      const request = new Request("http://test.workers.dev/mcp/");
      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
    });
  });

  describe("/sse endpoint", () => {
    it("should return SSE stream", async () => {
      const { default: worker } = await import("../index");

      const request = new Request("http://test.workers.dev/sse");
      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.body).toBeDefined();
    });

    it("should handle sessionId parameter", async () => {
      const { default: worker } = await import("../index");

      const request = new Request(
        "http://test.workers.dev/sse?sessionId=test-123",
      );
      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });
  });

  describe("URL path constraints", () => {
    it("should accept /mcp/{org} pattern", async () => {
      const { default: worker } = await import("../index");

      const request = new Request("http://test.workers.dev/mcp/acme-corp");
      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
    });

    it("should accept /mcp/{org}/{project} pattern", async () => {
      const { default: worker } = await import("../index");

      const request = new Request(
        "http://test.workers.dev/mcp/acme-corp/frontend",
      );
      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
    });
  });
});
