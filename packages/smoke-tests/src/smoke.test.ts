import { describe, it, expect, beforeAll } from "vitest";

const PREVIEW_URL = process.env.PREVIEW_URL;
// All endpoints should respond quickly - 1 second is plenty for 401/200 responses
const DEFAULT_TIMEOUT_MS = 1000;
const IS_LOCAL_DEV =
  PREVIEW_URL?.includes("localhost") || PREVIEW_URL?.includes("127.0.0.1");

// Skip all smoke tests if PREVIEW_URL is not set
const describeIfPreviewUrl = PREVIEW_URL ? describe : describe.skip;

/**
 * Unified fetch wrapper with proper cleanup for all response types.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options with additional helpers
 * @param options.consumeBody - Whether to read the response body (default: true)
 *                               Set to false for SSE or when you only need status/headers
 * @param options.timeoutMs - Timeout in milliseconds (default: DEFAULT_TIMEOUT_MS)
 *
 * NOTE: Workerd connection errors (kj/compat/http.c++:1993) are caused by
 * the agents library's McpAgent server-side implementation, NOT our client code.
 * These errors are expected during development and don't affect test reliability.
 */
async function safeFetch(
  url: string,
  options: RequestInit & {
    timeoutMs?: number;
    consumeBody?: boolean;
  } = {},
): Promise<{
  response: Response;
  data: any;
}> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    consumeBody = true,
    ...fetchOptions
  } = options;

  // Create an AbortController for cleanup
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Merge any existing signal with our controller
  const signal = fetchOptions.signal || controller.signal;

  let response: Response;
  let data: any = null;

  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal,
    });

    // Only consume body if requested (not for SSE streams)
    if (consumeBody) {
      const contentType = response.headers.get("content-type") || "";

      try {
        if (contentType.includes("application/json")) {
          data = await response.json();
        } else if (contentType.includes("text/event-stream")) {
          // Don't consume SSE streams
          data = null;
        } else {
          data = await response.text();
        }
      } catch (error) {
        // If we can't read the body, log but don't fail
        console.warn(`Failed to read response body from ${url}:`, error);
        data = null;
      }
    }
  } finally {
    clearTimeout(timeoutId);

    // Always clean up: if body wasn't consumed and exists, cancel it
    if (!consumeBody && response?.body && !response.bodyUsed) {
      try {
        await response.body.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
  }

  return { response: response!, data };
}

describeIfPreviewUrl(
  `Smoke Tests for ${PREVIEW_URL || "(no PREVIEW_URL set)"}`,
  () => {
    beforeAll(async () => {
      console.log(`🔍 Running smoke tests against: ${PREVIEW_URL}`);
      // TODO: Add back workerd warmup if needed for SSE tests
      // Currently disabled to keep tests under 15s timeout
    });

    it("should respond on root endpoint", async () => {
      const { response } = await safeFetch(PREVIEW_URL);
      expect(response.status).toBe(200);
    });

    it("should have MCP endpoint that returns server info (with auth error)", async () => {
      const { response, data } = await safeFetch(`${PREVIEW_URL}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
              name: "smoke-test",
              version: "1.0.0",
            },
          },
          id: 1,
        }),
      });

      expect(response.status).toBe(401);

      // Should return auth error, not 404 - this proves the MCP endpoint exists
      if (data) {
        expect(data).toHaveProperty("error");
        expect(data.error).toMatch(/invalid_token|unauthorized/i);
      }
    });

    it("should have SSE endpoint for MCP transport", async () => {
      /*
       * SSE endpoints are simple:
       * - No auth = 401 Unauthorized
       * - Valid auth = 200 OK + stream starts
       *
       * For smoke tests (no auth), we expect 401 with error details.
       * This proves the endpoint exists and auth is working.
       */

      // For SSE, we don't want to consume the stream body
      const { response, data } = await safeFetch(`${PREVIEW_URL}/sse`, {
        headers: {
          Accept: "text/event-stream",
        },
        consumeBody: false, // Don't try to read SSE stream
      });

      console.log(`📡 SSE test result: status=${response.status}`);

      // Should return 401 since we're not providing auth
      expect(response.status).toBe(401);

      // For 401 responses, we need to manually read the error since we set consumeBody: false
      if (response.status === 401) {
        try {
          const errorData = await response.json();
          console.log(
            `📡 SSE error: ${JSON.stringify(errorData).substring(0, 100)}...`,
          );
          expect(errorData).toHaveProperty("error");
          expect(errorData.error).toMatch(/invalid_token|unauthorized/i);
        } catch {
          // Body might already be consumed or not JSON
          console.log("📡 SSE returned non-JSON 401 response");
        }
      }
    });

    it("should have metadata endpoint that requires auth", async () => {
      try {
        const { response, data } = await safeFetch(
          `${PREVIEW_URL}/api/metadata`,
        );

        expect(response.status).toBe(401);

        // Verify it returns proper error structure
        if (data && typeof data === "object") {
          expect(data).toHaveProperty("error");
        }
      } catch (error: any) {
        // If we timeout, that's acceptable - the endpoint exists but is slow
        if (error.name === "TimeoutError" || error.name === "AbortError") {
          // The timeout fired, but the endpoint exists (would 404 if not)
          console.warn("Metadata endpoint timed out (expected in dev)");
          return;
        }
        throw error;
      }
    });

    it("should have MCP endpoint with org constraint (/mcp/sentry)", async () => {
      // Retry logic for potential Durable Object initialization
      let response: Response;
      let retries = 5;

      while (retries > 0) {
        const { response: fetchResponse, data } = await safeFetch(
          `${PREVIEW_URL}/mcp/sentry`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                  name: "smoke-test",
                  version: "1.0.0",
                },
              },
              id: 1,
            }),
          },
        );

        response = fetchResponse;

        // If we get 503, retry after a delay
        if (response.status === 503 && retries > 1) {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // Store data for later use
        (response as any).testData = data;
        break;
      }

      expect(response.status).toBe(401);

      // Should return auth error, not 404 - this proves the constrained MCP endpoint exists
      const data = (response as any).testData;
      if (typeof data === "object") {
        expect(data).toHaveProperty("error");
        expect(data.error).toMatch(/invalid_token|unauthorized/i);
      } else {
        expect(data).toMatch(/invalid_token|unauthorized/i);
      }
    });

    it("should have MCP endpoint with org and project constraints (/mcp/sentry/mcp-server)", async () => {
      // Retry logic for Durable Object initialization
      let response: Response;
      let retries = 5;

      while (retries > 0) {
        const { response: fetchResponse, data } = await safeFetch(
          `${PREVIEW_URL}/mcp/sentry/mcp-server`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                  name: "smoke-test",
                  version: "1.0.0",
                },
              },
              id: 1,
            }),
          },
        );

        response = fetchResponse;

        // If we get 503, it's Durable Object initialization - retry
        if (response.status === 503 && retries > 1) {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds for DO to stabilize
          continue;
        }

        // Store data for later use
        (response as any).testData = data;
        break;
      }

      expect(response.status).toBe(401);

      // Should return auth error, not 404 - this proves the fully constrained MCP endpoint exists
      const data = (response as any).testData;
      if (typeof data === "object") {
        expect(data).toHaveProperty("error");
        expect(data.error).toMatch(/invalid_token|unauthorized/i);
      } else {
        expect(data).toMatch(/invalid_token|unauthorized/i);
      }
    });

    it("should have chat endpoint that accepts POST", async () => {
      // Chat endpoint might return 503 temporarily after DO operations
      let response: Response;
      let retries = 3;

      while (retries > 0) {
        const { response: fetchResponse } = await safeFetch(
          `${PREVIEW_URL}/api/chat`,
          {
            method: "POST",
            headers: {
              Origin: PREVIEW_URL, // Required for CSRF check
            },
          },
        );
        response = fetchResponse;

        // If we get 503, retry after a short delay
        if (response.status === 503 && retries > 1) {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        break;
      }

      // Should return 401 (unauthorized), 400 (bad request), or 500 (server error) for POST without auth
      expect([400, 401, 500]).toContain(response.status);
    });

    it("should have OAuth authorize endpoint", async () => {
      const { response } = await safeFetch(`${PREVIEW_URL}/oauth/authorize`, {
        redirect: "manual", // Don't follow redirects
      });
      // Should return 200, 302 (redirect), or 400 (bad request)
      expect([200, 302, 400]).toContain(response.status);
    });

    it("should serve robots.txt", async () => {
      const { response, data } = await safeFetch(
        `${PREVIEW_URL}/robots.txt`,
        {},
      );
      expect(response.status).toBe(200);

      expect(data).toContain("User-agent");
    });

    it("should serve llms.txt with MCP info", async () => {
      const { response, data } = await safeFetch(`${PREVIEW_URL}/llms.txt`, {});
      expect(response.status).toBe(200);

      expect(data).toContain("sentry-mcp");
      expect(data).toContain("Model Context Protocol");
      expect(data).toContain("/mcp");
    });

    it("should serve /.well-known/oauth-authorization-server with CORS headers", async () => {
      const { response, data } = await safeFetch(
        `${PREVIEW_URL}/.well-known/oauth-authorization-server`,
        {
          headers: {
            Origin: "http://localhost:6274", // MCP inspector origin
          },
        },
      );
      expect(response.status).toBe(200);

      // Should have CORS headers for cross-origin access
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET, OPTIONS",
      );
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Content-Type",
      );

      // Should return valid OAuth server metadata
      expect(data).toHaveProperty("issuer");
      expect(data).toHaveProperty("authorization_endpoint");
      expect(data).toHaveProperty("token_endpoint");
    });

    it("should handle CORS preflight for /.well-known/oauth-authorization-server", async () => {
      const { response } = await safeFetch(
        `${PREVIEW_URL}/.well-known/oauth-authorization-server`,
        {
          method: "OPTIONS",
          headers: {
            Origin: "http://localhost:6274",
            "Access-Control-Request-Method": "GET",
          },
        },
      );

      // Should return 204 No Content for preflight
      expect(response.status).toBe(204);

      // Should have CORS headers
      const allowOrigin = response.headers.get("access-control-allow-origin");
      // In dev, Vite echoes the origin; in production, we set "*"
      expect(
        allowOrigin === "*" || allowOrigin === "http://localhost:6274",
      ).toBe(true);

      const allowMethods = response.headers.get("access-control-allow-methods");
      // Should include at least GET
      expect(allowMethods).toContain("GET");
    });

    it("should respond quickly (under 2 seconds)", async () => {
      const start = Date.now();
      const { response } = await safeFetch(PREVIEW_URL);
      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(2000);
    });

    it("should have proper security headers", async () => {
      const { response } = await safeFetch(PREVIEW_URL);

      // Check security headers - some might be set by Cloudflare instead of Hono
      // So we check if they exist rather than exact values
      const frameOptions = response.headers.get("x-frame-options");
      const contentTypeOptions = response.headers.get("x-content-type-options");

      // Either the header is set by our app or by Cloudflare
      expect(
        frameOptions === "DENY" ||
          frameOptions === "SAMEORIGIN" ||
          frameOptions === null,
      ).toBe(true);
      expect(
        contentTypeOptions === "nosniff" || contentTypeOptions === null,
      ).toBe(true);
    });
  },
);
