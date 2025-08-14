import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock URLPattern for test environment
beforeAll(() => {
  if (!globalThis.URLPattern) {
    globalThis.URLPattern = class URLPattern {
      constructor(private pattern: { pathname: string }) {}

      exec(url: URL) {
        const pathname = url.pathname;

        // Simple mock that matches our patterns
        if (this.pattern.pathname === "/mcp/:org?/:project?") {
          const match = pathname.match(/^\/mcp(?:\/([^\/]+))?(?:\/([^\/]+))?$/);
          if (match) {
            return {
              pathname: {
                groups: {
                  org: match[1],
                  project: match[2],
                },
              },
            };
          }
        }

        if (this.pattern.pathname === "/sse/:org?/:project?") {
          const match = pathname.match(/^\/sse(?:\/([^\/]+))?(?:\/([^\/]+))?$/);
          if (match) {
            return {
              pathname: {
                groups: {
                  org: match[1],
                  project: match[2],
                },
              },
            };
          }
        }

        return null;
      }
    } as any;
  }
});

// Mock dependencies
vi.mock("@sentry/cloudflare", () => ({
  instrumentDurableObjectWithSentry: (config: any, cls: any) => cls,
}));

vi.mock("../sentry.config", () => ({
  default: {
    partial: () => ({}),
  },
}));

vi.mock("@sentry/mcp-server/server", () => ({
  configureServer: vi.fn(),
}));

vi.mock("agents/mcp", () => ({
  McpAgent: class MockMcpAgent {
    constructor(
      public state: any,
      public env: any,
    ) {}
    async fetch(request: Request) {
      return new Response("mock");
    }
    static serve() {
      return { fetch: vi.fn() };
    }
    static serveSSE() {
      return { fetch: vi.fn() };
    }
  },
}));

describe("mcp-transport URL parsing", () => {
  it("should extract organization and project from URL path", async () => {
    const { default: SentryMCP } = await import("./mcp-transport");

    const mockState = {
      storage: {
        get: vi.fn(),
        put: vi.fn(),
      },
    } as any;

    const mockEnv = {} as any;
    const instance = new (SentryMCP as any)(mockState, mockEnv);

    // Mock the ctx and props to simulate Durable Object context
    instance.ctx = mockState;
    instance.props = {
      accessToken: "test-token",
      organizationSlug: "oauth-org",
      id: "user-123",
    };

    const request = new Request("https://example.com/mcp/acme-corp/frontend");
    await instance.fetch(request);

    // Verify storage was called with URL constraints
    expect(mockState.storage.put).toHaveBeenCalledWith("urlConstraints", {
      organizationSlug: "acme-corp",
      projectSlug: "frontend",
    });
  });

  it("should fallback to OAuth org when no URL constraints", async () => {
    const { default: SentryMCP } = await import("./mcp-transport");

    const mockState = {
      storage: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      },
    } as any;

    const mockEnv = {} as any;
    const instance = new (SentryMCP as any)(mockState, mockEnv);

    instance.ctx = mockState;
    instance.props = {
      accessToken: "test-token",
      organizationSlug: "oauth-org",
      id: "user-123",
    };

    const request = new Request("https://example.com/mcp");
    await instance.fetch(request);

    // Should not store any URL constraints for base /mcp path
    expect(mockState.storage.put).not.toHaveBeenCalledWith(
      "urlConstraints",
      expect.anything(),
    );
  });
});
