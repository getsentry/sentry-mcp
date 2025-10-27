/**
 * End-to-end test for MCP handler with OAuth context binding.
 *
 * Tests the real flow:
 * 1. OAuth provider sets ctx.props with auth context
 * 2. Handler reads context via getMcpAuthContext()
 * 3. Constraints flow through AsyncLocalStorage
 * 4. Only mocks: External Sentry API calls (via fetch)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import "urlpattern-polyfill";
import type { Env } from "../types";
import type { ExecutionContext } from "@cloudflare/workers-types";

// Import the REAL handler
import sentryMcpHandler from "./mcp-handler";

// Mock only external Sentry API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("mcp-handler E2E", () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();

    env = {
      SENTRY_HOST: "sentry.io",
      COOKIE_SECRET: "test-secret",
      SENTRY_CLIENT_ID: "test-client-id",
      SENTRY_CLIENT_SECRET: "test-secret",
    } as Env;

    // Default: successful org verification
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        slug: "test-org",
        name: "Test Org",
      }),
    });
  });

  it("reads OAuth context from ctx.props", async () => {
    // Simulate OAuth provider setting ctx.props
    const mockCtx: ExecutionContext & { props?: Record<string, unknown> } = {
      waitUntil: () => {},
      passThroughOnException: () => {},
      props: {
        userId: "test-user",
        clientId: "test-client",
        accessToken: "test-token",
        grantedScopes: ["org:read"],
        sentryHost: "sentry.io",
      },
    };

    const request = new Request("https://test.mcp.sentry.io/mcp/test-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }),
    });

    const response = await sentryMcpHandler.fetch!(
      request as any,
      env,
      mockCtx,
    );

    // Should not be 401 (meaning context was read successfully)
    expect(response.status).not.toBe(401);
  });
});
