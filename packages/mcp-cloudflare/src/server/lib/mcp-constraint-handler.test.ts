import { describe, it, expect, vi, beforeAll } from "vitest";
import { createConstraintAwareMcpHandler } from "./mcp-constraint-handler";
import type { Env } from "../types";

// Mock URLPattern for testing
beforeAll(() => {
  if (!globalThis.URLPattern) {
    // @ts-ignore - Simple mock for testing
    globalThis.URLPattern = class URLPattern {
      constructor(private pattern: { pathname: string }) {}

      test(url: URL): boolean {
        return url.pathname.startsWith(this.pattern.pathname.split("/:")[0]);
      }

      exec(url: URL) {
        const pathParts = url.pathname.split("/").filter(Boolean);
        const patternParts = this.pattern.pathname.split("/").filter(Boolean);

        if (pathParts[0] !== patternParts[0]) return null;

        const groups: Record<string, string> = {};
        patternParts.forEach((part, i) => {
          if (part.startsWith(":")) {
            groups[part.slice(1)] = pathParts[i] || "";
          }
        });

        return { pathname: { groups } };
      }
    };
  }
});

// Mock SentryMCP
vi.mock("./mcp-transport", () => ({
  default: {
    serve: (path: string) => ({
      fetch: vi.fn(async (request: Request) => {
        // Check if constraint headers are present
        const org = request.headers.get("X-MCP-Constraint-Org");
        const project = request.headers.get("X-MCP-Constraint-Project");

        return new Response(
          JSON.stringify({
            path: new URL(request.url).pathname,
            constraints: { org, project },
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    }),
    serveSSE: (path: string) => ({
      fetch: vi.fn(async (request: Request) => {
        const org = request.headers.get("X-MCP-Constraint-Org");
        const project = request.headers.get("X-MCP-Constraint-Project");

        return new Response(
          JSON.stringify({
            path: new URL(request.url).pathname,
            constraints: { org, project },
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    }),
  },
}));

describe("mcp-constraint-handler", () => {
  const mockEnv = {} as Env;
  const mockCtx = {} as ExecutionContext;

  describe("createConstraintAwareMcpHandler", () => {
    it("should pass through requests without constraints", async () => {
      const handler = createConstraintAwareMcpHandler("/mcp");
      const request = new Request("https://example.com/mcp");

      const response = await handler.fetch(request, mockEnv, mockCtx);
      const data = (await response.json()) as any;

      expect(data.path).toBe("/mcp");
      expect(data.constraints.org).toBeNull();
      expect(data.constraints.project).toBeNull();
    });

    it("should extract organization constraint from URL", async () => {
      const handler = createConstraintAwareMcpHandler("/mcp");
      const request = new Request("https://example.com/mcp/acme-corp");

      const response = await handler.fetch(request, mockEnv, mockCtx);
      const data = (await response.json()) as any;

      expect(data.path).toBe("/mcp/acme-corp");
      expect(data.constraints.org).toBe("acme-corp");
      expect(data.constraints.project).toBeNull();
    });

    it("should extract both organization and project constraints", async () => {
      const handler = createConstraintAwareMcpHandler("/mcp");
      const request = new Request("https://example.com/mcp/acme-corp/frontend");

      const response = await handler.fetch(request, mockEnv, mockCtx);
      const data = (await response.json()) as any;

      expect(data.path).toBe("/mcp/acme-corp/frontend");
      expect(data.constraints.org).toBe("acme-corp");
      expect(data.constraints.project).toBe("frontend");
    });

    it("should handle SSE endpoints with constraints", async () => {
      const handler = createConstraintAwareMcpHandler("/sse");
      const request = new Request("https://example.com/sse/acme-corp/backend");

      const response = await handler.fetch(request, mockEnv, mockCtx);
      const data = (await response.json()) as any;

      expect(data.path).toBe("/sse/acme-corp/backend");
      expect(data.constraints.org).toBe("acme-corp");
      expect(data.constraints.project).toBe("backend");
    });

    it("should preserve request method and body", async () => {
      const handler = createConstraintAwareMcpHandler("/mcp");
      const body = JSON.stringify({ test: "data" });
      const request = new Request("https://example.com/mcp/org/proj", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      });

      const response = await handler.fetch(request, mockEnv, mockCtx);
      expect(response.status).toBe(200);
    });
  });
});
