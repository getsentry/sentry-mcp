import type { ExecutionContext } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./types";

const {
  MockOAuthProvider,
  mockOAuthProviderFetch,
  mockGetClientIp,
  mockCheckRateLimit,
  mockActiveSpan,
  mockMetricsCount,
} = vi.hoisted(() => {
  const mockOAuthProviderFetch = vi.fn();
  const MockOAuthProvider = vi.fn(function MockOAuthProvider() {
    return { fetch: mockOAuthProviderFetch };
  });
  const mockGetClientIp = vi.fn<(request: Request) => string | null>(
    () => null,
  );

  return {
    MockOAuthProvider,
    mockOAuthProviderFetch,
    mockGetClientIp,
    mockCheckRateLimit: vi.fn(),
    mockActiveSpan: {
      setAttribute: vi.fn(),
    },
    mockMetricsCount: vi.fn(),
  };
});

vi.mock("@cloudflare/workers-oauth-provider", () => ({
  default: MockOAuthProvider,
}));

vi.mock("@sentry/cloudflare", () => ({
  getActiveSpan: vi.fn(() => mockActiveSpan),
  metrics: {
    count: mockMetricsCount,
  },
  setUser: vi.fn(),
  withSentry: vi.fn((_config, handler) => handler),
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

  it("keeps demo chat client metadata public and read-only", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("{}", {
        headers: {
          "Access-Control-Allow-Origin": "https://evil.com",
          "Access-Control-Allow-Methods": "*",
          "Access-Control-Allow-Headers": "Authorization, *",
          "Access-Control-Allow-Credentials": "true",
        },
      }),
    );

    const response = await handler.fetch!(
      new Request(
        "https://mcp.sentry.dev/.well-known/oauth-client/demo-chat.json",
      ),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type",
    );
    expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(
      false,
    );
  });

  it("enables CIMD while preserving Dynamic Client Registration", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(new Response("ok"));

    await handler.fetch!(
      new Request("https://mcp.sentry.dev/oauth/token", { method: "POST" }),
      env,
      ctx,
    );

    expect(MockOAuthProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRegistrationEndpoint: "/oauth/register",
        clientIdMetadataDocumentEnabled: true,
      }),
    );
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

  it("replaces an existing resource_metadata with the path-specific one (RFC 9110 §11.2)", async () => {
    // The Cloudflare OAuth provider library emits its own resource_metadata
    // pointing at the origin (which 404s on this deployment). We must replace
    // it rather than append, so the challenge contains exactly one
    // resource_metadata parameter.
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer realm="OAuth", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource", error="invalid_token", error_description="Missing or invalid access token"',
        },
      }),
    );

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/mcp"),
      env,
      ctx,
    );

    expect(response.status).toBe(401);
    const header = response.headers.get("WWW-Authenticate")!;
    expect(header).toBe(
      'Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp"',
    );
    // Defensive: ensure resource_metadata only appears once.
    expect(header.match(/resource_metadata\s*=/gi)?.length).toBe(1);
  });

  it("removes pre-existing resource_metadata even when it appears first in the challenge", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource", error="invalid_token"',
        },
      }),
    );

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/mcp"),
      env,
      ctx,
    );

    expect(response.status).toBe(401);
    const header = response.headers.get("WWW-Authenticate")!;
    expect(header).toBe(
      'Bearer error="invalid_token", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp"',
    );
    expect(header.match(/resource_metadata\s*=/gi)?.length).toBe(1);
  });

  it("rejects client registration with a userinfo-spoofed redirect URI", async () => {
    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Sentry MCP",
          redirect_uris: ["https://mcp.sentry.dev@example.io/callback"],
        }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_redirect_uri");
    expect(mockOAuthProviderFetch).not.toHaveBeenCalled();
  });

  it("allows client registration with legitimate redirect URIs", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: "abc" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Test Client",
          redirect_uris: ["https://example.com/callback"],
        }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(201);
    expect(mockOAuthProviderFetch).toHaveBeenCalled();
  });

  it("ignores commas inside quoted error_description values when parsing the challenge", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer realm="OAuth", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource", error="invalid_token", error_description="Missing, invalid, or expired access token"',
        },
      }),
    );

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/mcp"),
      env,
      ctx,
    );

    expect(response.status).toBe(401);
    const header = response.headers.get("WWW-Authenticate")!;
    expect(header).toBe(
      'Bearer realm="OAuth", error="invalid_token", error_description="Missing, invalid, or expired access token", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp"',
    );
    expect(header.match(/resource_metadata\s*=/gi)?.length).toBe(1);
  });

  it("annotates OAuth provider invalid-token responses without logging token values", async () => {
    mockOAuthProviderFetch.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer realm="OAuth", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource", error="invalid_token", error_description="Missing or invalid access token"',
        },
      }),
    );

    const response = await handler.fetch!(
      new Request("https://mcp.sentry.dev/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer user-id:grant-id:secret",
          "User-Agent": "Claude-Code/1.0",
        },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(401);
    expect(mockActiveSpan.setAttribute).toHaveBeenCalledWith(
      "app.oauth.error",
      "invalid_token",
    );
    expect(mockActiveSpan.setAttribute).toHaveBeenCalledWith(
      "app.oauth.error_description",
      "missing_or_invalid_access_token",
    );
    expect(mockActiveSpan.setAttribute).toHaveBeenCalledWith(
      "app.oauth.request.token_shape",
      "wrapper",
    );
    expect(mockMetricsCount).toHaveBeenCalledWith("app.server.response", 1, {
      attributes: expect.objectContaining({
        "app.client.family": "claude-code",
        "app.oauth.error": "invalid_token",
        "app.oauth.error_description": "missing_or_invalid_access_token",
        "app.oauth.request.token_shape": "wrapper",
        "http.response.status_code": 401,
      }),
    });
  });
});
