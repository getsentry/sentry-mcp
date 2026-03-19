import type { ExecutionContext } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./types";

const {
  MockOAuthProvider,
  mockOAuthProviderFetch,
  mockGetClientIp,
  mockCheckRateLimit,
} = vi.hoisted(() => {
  const mockOAuthProviderFetch = vi.fn();
  const MockOAuthProvider = vi
    .fn()
    .mockImplementation(() => ({ fetch: mockOAuthProviderFetch }));

  return {
    MockOAuthProvider,
    mockOAuthProviderFetch,
    mockGetClientIp: vi.fn(() => null),
    mockCheckRateLimit: vi.fn(),
  };
});

vi.mock("@cloudflare/workers-oauth-provider", () => ({
  default: MockOAuthProvider,
}));

vi.mock("./app", () => ({
  default: { fetch: vi.fn() },
}));

vi.mock("./lib/mcp-handler", () => ({
  default: { fetch: vi.fn() },
}));

vi.mock("./oauth", () => ({
  tokenExchangeCallback: vi.fn(),
}));

vi.mock("./sentry.config", () => ({
  default: vi.fn(() => ({})),
}));

vi.mock("./utils/client-ip", () => ({
  getClientIp: mockGetClientIp,
}));

vi.mock("./utils/rate-limiter", () => ({
  checkRateLimit: mockCheckRateLimit,
  MCP_RATE_LIMIT_EXCEEDED_MESSAGE:
    "Rate limit exceeded. Please wait before trying again.",
}));

import handler from "./index";

describe("worker entrypoint", () => {
  const env = {
    MCP_RATE_LIMITER: {},
  } as Env;
  const ctx = {
    props: undefined,
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientIp.mockReturnValue(null);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  it("returns restrictive preflight CORS for public metadata endpoints", async () => {
    const response = await handler.fetch!(
      new Request(
        "https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp",
        { method: "OPTIONS" },
      ),
      env,
      ctx,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type",
    );
    expect(MockOAuthProvider).not.toHaveBeenCalled();
  });

  it("does not expose root protected resource metadata", async () => {
    const response = await handler.fetch!(
      new Request(
        "https://mcp.sentry.dev/.well-known/oauth-protected-resource",
      ),
      env,
      ctx,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(MockOAuthProvider).not.toHaveBeenCalled();
  });

  it("strips CORS headers from non-public OAuth endpoints", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "https://evil.com",
          "Access-Control-Allow-Methods": "*",
          "Access-Control-Allow-Headers": "Authorization, *",
          "Access-Control-Max-Age": "86400",
          "Access-Control-Expose-Headers": "X-Trace-Id",
        },
      }),
    );

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/oauth/token"),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(response.headers.has("Access-Control-Allow-Methods")).toBe(false);
    expect(response.headers.has("Access-Control-Allow-Headers")).toBe(false);
    expect(response.headers.has("Access-Control-Max-Age")).toBe(false);
    expect(response.headers.has("Access-Control-Expose-Headers")).toBe(false);
  });

  it("patches MCP 401 responses with protected resource metadata", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer error="invalid_token"',
          "Access-Control-Allow-Origin": "https://evil.com",
        },
      }),
    );

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/mcp"),
      env,
      ctx,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="invalid_token", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp"',
    );
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("passes tracked app responses through the default handler", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(new Response("ok"));

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/api/chat", { method: "POST" }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
  });

  it("returns 429 when MCP/OAuth IP limiting blocks the request", async () => {
    mockGetClientIp.mockReturnValue("192.0.2.1");
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      errorMessage: "Rate limit exceeded. Please wait before trying again.",
    });

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/oauth/token", { method: "POST" }),
      env,
      ctx,
    );

    expect(response.status).toBe(429);
  });

  it("patches scoped MCP 401 responses with path-specific protected resource metadata", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer error="invalid_token"',
        },
      }),
    );

    const response = await handler.fetch!(
      new Request(
        "https://mcp.sentry.dev/mcp/sentry/mcp-server?experimental=1",
      ),
      env,
      ctx,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="invalid_token", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp/sentry/mcp-server?experimental=1"',
    );
  });

  it("patches organization-scoped MCP 401 responses with path-specific protected resource metadata", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer error="invalid_token"',
        },
      }),
    );

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/mcp/sentry"),
      env,
      ctx,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="invalid_token", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp/sentry"',
    );
  });
});
