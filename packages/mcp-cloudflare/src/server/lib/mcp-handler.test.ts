import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import { fetchMock } from "cloudflare:test";
import "urlpattern-polyfill";
import type { Env } from "../types";
import type { ExecutionContext } from "@cloudflare/workers-types";

// Mock Sentry to avoid actual telemetry
vi.mock("@sentry/cloudflare", () => ({
  flush: vi.fn(),
}));

// Enable fetch mocking
beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("mcp-handler integration", () => {
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
    // Mock organization lookup
    fetchMock
      .get("https://sentry.io")
      .intercept({ path: "/api/0/organizations/sentry-mcp-evals/" })
      .reply(
        200,
        JSON.stringify({
          slug: "sentry-mcp-evals",
          name: "Sentry MCP Evals",
          region_url: "https://us.sentry.io",
        }),
      );

    const { default: handler } = await import("./mcp-handler");
    const request = new Request(
      "https://test.mcp.sentry.io/mcp/sentry-mcp-evals",
    );

    const response = await handler.fetch!(request as any, env, ctx);

    // Should succeed - verifies full flow:
    // 1. URL parsing extracts org constraint
    // 2. Auth extracted from ExecutionContext.props
    // 3. Constraint verification passes (mocked API call)
    // 4. ServerContext built and stored in AsyncLocalStorage
    // 5. MCP handler invoked successfully
    expect(response.status).toBe(200);
  });

  it("returns 404 for invalid organization", async () => {
    // Mock nonexistent organization
    fetchMock
      .get("https://sentry.io")
      .intercept({ path: "/api/0/organizations/nonexistent-org/" })
      .reply(404, JSON.stringify({ detail: "Organization not found" }));

    const { default: handler } = await import("./mcp-handler");
    const request = new Request(
      "https://test.mcp.sentry.io/mcp/nonexistent-org",
    );

    const response = await handler.fetch!(request as any, env, ctx);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("not found");
  });

  it("returns 404 for invalid project", async () => {
    // Mock valid organization but nonexistent project
    fetchMock
      .get("https://sentry.io")
      .intercept({ path: "/api/0/organizations/sentry-mcp-evals/" })
      .reply(
        200,
        JSON.stringify({
          slug: "sentry-mcp-evals",
          name: "Sentry MCP Evals",
          region_url: "https://us.sentry.io",
        }),
      );

    fetchMock
      .get("https://sentry.io")
      .intercept({
        path: "/api/0/projects/sentry-mcp-evals/nonexistent-project/",
      })
      .reply(404, JSON.stringify({ detail: "Project not found" }));

    const { default: handler } = await import("./mcp-handler");
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

    const { default: handler } = await import("./mcp-handler");
    const request = new Request("https://test.mcp.sentry.io/mcp");

    await expect(
      handler.fetch!(request as any, env, ctxWithoutAuth as any),
    ).rejects.toThrow("No authentication context");
  });
});
