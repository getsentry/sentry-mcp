import { describe, it, expect, vi } from "vitest";

// Only mock the Sentry wrapper to return the unwrapped class for testing
vi.mock("@sentry/cloudflare", () => ({
  instrumentDurableObjectWithSentry: (config: any, cls: any) => cls,
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

  it("should handle org-only URL constraints", async () => {
    const { default: SentryMCP } = await import("./mcp-transport");

    const mockState = {
      storage: {
        get: vi.fn(),
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

    const request = new Request("https://example.com/mcp/acme-corp");
    await instance.fetch(request);

    expect(mockState.storage.put).toHaveBeenCalledWith("urlConstraints", {
      organizationSlug: "acme-corp",
      projectSlug: undefined,
    });
  });

  it("should handle SSE endpoints", async () => {
    const { default: SentryMCP } = await import("./mcp-transport");

    const mockState = {
      storage: {
        get: vi.fn(),
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

    const request = new Request("https://example.com/sse/acme-corp/frontend");
    await instance.fetch(request);

    expect(mockState.storage.put).toHaveBeenCalledWith("urlConstraints", {
      organizationSlug: "acme-corp",
      projectSlug: "frontend",
    });
  });

  it("should reject malicious path traversal attempts", async () => {
    const { default: SentryMCP } = await import("./mcp-transport");

    const mockState = {
      storage: {
        get: vi.fn(),
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

    // Test various malicious inputs
    const maliciousUrls = [
      "https://example.com/mcp/org/project/extra/path", // Too many path segments
      "https://example.com/mcp/org%2Fpath/project", // URL encoded slash
      "https://example.com/mcp/org%3A%2F%2Fexample.com/project", // URL encoded protocol
    ];

    for (const url of maliciousUrls) {
      const request = new Request(url);
      await instance.fetch(request);

      // Should not store constraints for malformed paths
      expect(mockState.storage.put).not.toHaveBeenCalledWith(
        "urlConstraints",
        expect.anything(),
      );
      mockState.storage.put.mockClear();
    }
  });

  it("should handle valid special characters safely", async () => {
    const { default: SentryMCP } = await import("./mcp-transport");

    const mockState = {
      storage: {
        get: vi.fn(),
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

    // Test valid slug characters: alphanumeric, hyphens, underscores, dots
    const request = new Request(
      "https://example.com/mcp/org-with-dash/project_underscore.v2",
    );
    await instance.fetch(request);

    expect(mockState.storage.put).toHaveBeenCalledWith("urlConstraints", {
      organizationSlug: "org-with-dash",
      projectSlug: "project_underscore.v2",
    });
  });

  it("should reject invalid slug characters", async () => {
    const { default: SentryMCP } = await import("./mcp-transport");

    const mockState = {
      storage: {
        get: vi.fn(),
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

    // Test various invalid slug patterns
    const invalidUrls = [
      "https://example.com/mcp/org with spaces/project",
      "https://example.com/mcp/org@invalid/project",
      "https://example.com/mcp/org%20encoded/project",
      "https://example.com/mcp/org://url/project",
      "https://example.com/mcp/very-long-slug-that-exceeds-the-maximum-allowed-length-of-one-hundred-characters-and-should-be-rejected/project",
      "https://example.com/mcp/-starts-with-dash/project",
      "https://example.com/mcp/ends-with-dash-/project",
      "https://example.com/mcp//empty-segment/project",
    ];

    for (const url of invalidUrls) {
      const request = new Request(url);
      await instance.fetch(request);

      // Should not store constraints for invalid slugs
      expect(mockState.storage.put).not.toHaveBeenCalledWith(
        "urlConstraints",
        expect.anything(),
      );
      mockState.storage.put.mockClear();
    }
  });

  it("should handle edge cases in slug validation", async () => {
    const { default: SentryMCP } = await import("./mcp-transport");

    const mockState = {
      storage: {
        get: vi.fn(),
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

    // Test single character (valid)
    const validRequest = new Request("https://example.com/mcp/a/b");
    await instance.fetch(validRequest);

    expect(mockState.storage.put).toHaveBeenCalledWith("urlConstraints", {
      organizationSlug: "a",
      projectSlug: "b",
    });
    mockState.storage.put.mockClear();

    // Test minimum valid length (2 chars)
    const minRequest = new Request("https://example.com/mcp/ab/cd");
    await instance.fetch(minRequest);

    expect(mockState.storage.put).toHaveBeenCalledWith("urlConstraints", {
      organizationSlug: "ab",
      projectSlug: "cd",
    });
  });
});
