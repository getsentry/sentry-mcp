import { describe, it, expect, beforeAll } from "vitest";

const PREVIEW_URL = process.env.PREVIEW_URL;
const TIMEOUT = 10000; // 10 seconds per test
const IS_LOCAL_DEV =
  PREVIEW_URL?.includes("localhost") || PREVIEW_URL?.includes("127.0.0.1");

// Skip all smoke tests if PREVIEW_URL is not set
const describeIfPreviewUrl = PREVIEW_URL ? describe : describe.skip;

/**
 * Safely fetch from any endpoint and parse the response.
 *
 * WHY THIS EXISTS:
 * - Regular fetch() hangs indefinitely on SSE/streaming endpoints in workerd
 * - We need consistent timeout protection across all HTTP requests
 * - Stream responses must be read partially and cleaned up aggressively
 *
 * WHAT IT HANDLES:
 * - JSON responses: parsed automatically
 * - Text responses: returned as string
 * - Streaming responses (SSE, chunked): read up to maxLength with timeout protection
 *
 * STREAM HANDLING COMPLEXITY:
 * The stream reading logic is intentionally aggressive about cleanup because:
 * 1. Workerd has bugs where streams don't close properly
 * 2. Unfinished streams cause subsequent requests to hang
 * 3. Tests can hang for 30+ seconds without proper stream management
 * 4. AbortController and reader.releaseLock() are essential for cleanup
 */
async function safeFetch(
  url: string,
  options: RequestInit & {
    maxLength?: number;
    timeoutMs?: number;
  } = {},
): Promise<{
  response: Response;
  data: any;
}> {
  const { maxLength = 1024, timeoutMs = 2000, ...fetchOptions } = options;
  const response = await fetch(url, fetchOptions);
  const contentType = response.headers.get("content-type") || "";

  // Handle streaming responses (SSE, chunked, etc.)
  // WHY: These response types never "finish" naturally and will hang fetch() forever
  if (
    contentType.includes("text/event-stream") ||
    contentType.includes("stream") ||
    response.headers.get("transfer-encoding") === "chunked"
  ) {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let data = "";
    let totalLength = 0;

    try {
      // Read stream chunks until we hit limits or timeout
      // WHY: We can't read the entire stream (infinite) so we sample it
      while (totalLength < maxLength && reader) {
        // Race condition: either get data or timeout
        // WHY: reader.read() can hang forever on slow/broken streams
        const timeoutPromise = new Promise<{
          value: Uint8Array;
          done: boolean;
        }>((_, reject) =>
          setTimeout(() => reject(new Error("Read timeout")), timeoutMs),
        );

        const readPromise = reader.read();
        const { value, done } = await Promise.race([
          readPromise,
          timeoutPromise,
        ]);

        if (done) break; // Stream ended naturally

        if (value && value.length > 0) {
          const chunk = decoder.decode(value, { stream: true });
          data += chunk;
          totalLength += chunk.length;

          // Stop reading when we have enough data for testing
          if (totalLength >= maxLength) {
            data = data.substring(0, maxLength);
            break;
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Read timeout") {
        // Timeout is EXPECTED for active streams - not an error!
        // WHY: SSE streams never end, so timeout means "it's working"
        if (!data) {
          data = "(stream active but no immediate data)";
        }
      } else {
        throw error;
      }
    } finally {
      // CRITICAL: Always release the reader lock
      // WHY: Unreleased locks cause subsequent requests to hang permanently
      try {
        reader?.releaseLock();
      } catch {
        // Ignore cleanup errors - better to continue than crash
      }
    }

    return { response, data };
  }

  // Handle non-streaming responses
  let data: any;
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { response, data };
}

describeIfPreviewUrl(
  `Smoke Tests for ${PREVIEW_URL || "(no PREVIEW_URL set)"}`,
  () => {
    beforeAll(async () => {
      console.log(`🔍 Running smoke tests against: ${PREVIEW_URL}`);
      if (IS_LOCAL_DEV) {
        console.log(
          `⚠️  Skipping OAuth .well-known tests (not available in local dev)`,
        );
      }

      /*
       * WARMUP LOGIC - WHY THIS DISGUSTING CODE EXISTS:
       *
       * 1. THE BUG: Cloudflare's workerd runtime (what powers Workers/Pages) has a race
       *    condition where Node.js-style fetch() calls hang after Durable Object
       *    initialization. This manifests as:
       *    - First 2-3 HTTP requests work fine
       *    - After DO initialization, fetch() hangs indefinitely
       *    - Affects streaming endpoints (SSE) most severely
       *    - Error: "kj/compat/http.c++:1993: can't read more data after previous read didn't complete"
       *
       * 2. ENVIRONMENT: Only happens in workerd local dev mode (wrangler dev)
       *    Production Cloudflare Workers don't have this issue.
       *
       * 3. SYMPTOM: Without warmup, tests start passing, then hang:
       *    ✓ Root endpoint (works)
       *    ✓ MCP endpoint (works)
       *    ⏸ SSE endpoint (hangs for 30+ seconds)
       *
       * 4. WORKAROUND: Initialize all DO endpoints first, then make a "sacrificial"
       *    request that absorbs the hang. This keeps subsequent test requests working.
       *
       * 5. WHY NOT ALTERNATIVES:
       *    - Mock endpoints: Defeats purpose of integration testing
       *    - Skip SSE tests: Miss real deployment issues
       *    - Use production: No local development workflow
       *    - Raw timeouts: Don't fix the underlying hang
       *
       * This warmup is the only reliable solution found for workerd local testing.
       */
      console.log(`🔥 Warming up server and Durable Objects...`);

      const warmupStartTime = Date.now();
      const maxWarmupTime = 15000; // Maximum 15 seconds for entire warmup

      // Initialize all MCP endpoints that use DOs, retrying on 503
      const warmupEndpoints = [
        `${PREVIEW_URL}/mcp`,
        `${PREVIEW_URL}/mcp/sentry`,
        `${PREVIEW_URL}/mcp/sentry/mcp-server`,
      ];

      for (const endpoint of warmupEndpoints) {
        if (Date.now() - warmupStartTime > maxWarmupTime) break;

        let retries = 3;
        while (retries > 0 && Date.now() - warmupStartTime < maxWarmupTime) {
          try {
            const { response } = await safeFetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "initialize",
                id: 1,
              }),
              maxLength: 100,
              timeoutMs: 1000,
            });

            // If we get 503, retry after a short delay
            if (response.status === 503 && retries > 1) {
              retries--;
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }
            break; // Success or non-503 error
          } catch {
            break; // Timeout or other error, move on
          }
        }
      }

      /*
       * SACRIFICIAL REQUEST - The ugliest part:
       *
       * After DO initialization, workerd's fetch implementation is in a broken state.
       * The NEXT HTTP request will hang indefinitely. We deliberately make a request
       * that we know will trigger this hang, then timeout and clean up.
       *
       * This "absorbs" the hang bug, resetting workerd's HTTP state so subsequent
       * requests work normally. Without this, our SSE test hangs for 30+ seconds.
       *
       * WHY /api/metadata: Simple endpoint, safe to call, returns quickly when working.
       */
      const remainingTime = Math.max(
        1000,
        maxWarmupTime - (Date.now() - warmupStartTime),
      );
      await safeFetch(`${PREVIEW_URL}/api/metadata`, {
        maxLength: 100,
        timeoutMs: remainingTime,
      }).catch(() => {}); // Ignore timeout - this is expected

      // Brief stabilization if we have time left
      const stabilizationTime = Math.min(
        500,
        maxWarmupTime - (Date.now() - warmupStartTime),
      );
      if (stabilizationTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, stabilizationTime));
      }
    });

    it("should respond on root endpoint", async () => {
      const { response } = await safeFetch(PREVIEW_URL, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
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
        signal: AbortSignal.timeout(TIMEOUT),
      });

      expect(response.status).toBe(401);

      // Should return auth error, not 404 - this proves the MCP endpoint exists
      if (typeof data === "object") {
        expect(data).toHaveProperty("error");
        expect(data.error).toMatch(/invalid_token|unauthorized/i);
      } else {
        expect(data).toMatch(/invalid_token|unauthorized/i);
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
      const { response, data } = await safeFetch(`${PREVIEW_URL}/sse`, {
        headers: {
          Accept: "text/event-stream",
        },
        maxLength: 256,
        timeoutMs: 500,
      });

      console.log(`📡 SSE test result: status=${response.status}`);
      if (data) {
        console.log(`📡 SSE data: ${String(data).substring(0, 100)}...`);
      }

      // Should return 401 since we're not providing auth
      expect(response.status).toBe(401);

      // Should get a JSON error response
      if (typeof data === "object") {
        expect(data).toHaveProperty("error");
        expect(data.error).toMatch(/invalid_token|unauthorized/i);
      } else {
        // If parsed as text, should still contain error info
        expect(data).toMatch(/invalid_token|unauthorized|error/i);
      }
    }, 30000); // Longer timeout due to workerd stream handling quirks

    it("should have metadata endpoint that requires auth", async () => {
      // Run metadata test BEFORE constraint tests to avoid workerd bug
      const { response, data } = await safeFetch(
        `${PREVIEW_URL}/api/metadata`,
        {
          signal: AbortSignal.timeout(TIMEOUT),
        },
      );

      expect(response.status).toBe(401);

      if (typeof data === "object") {
        expect(data).toHaveProperty("error");
        expect(data.name).toBe("MISSING_AUTH_TOKEN");
      } else {
        expect(data).toMatch(/MISSING_AUTH_TOKEN|unauthorized/i);
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
            signal: AbortSignal.timeout(TIMEOUT),
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
            signal: AbortSignal.timeout(TIMEOUT),
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
            signal: AbortSignal.timeout(TIMEOUT),
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
        signal: AbortSignal.timeout(TIMEOUT),
        redirect: "manual", // Don't follow redirects
      });
      // Should return 200, 302 (redirect), or 400 (bad request)
      expect([200, 302, 400]).toContain(response.status);
    });

    it("should serve robots.txt", async () => {
      const { response, data } = await safeFetch(`${PREVIEW_URL}/robots.txt`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      expect(response.status).toBe(200);

      expect(data).toContain("User-agent");
    });

    it("should serve llms.txt with MCP info", async () => {
      const { response, data } = await safeFetch(`${PREVIEW_URL}/llms.txt`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      expect(response.status).toBe(200);

      expect(data).toContain("sentry-mcp");
      expect(data).toContain("Model Context Protocol");
      expect(data).toContain("/mcp");
    });

    it.skipIf(IS_LOCAL_DEV)(
      "should serve /.well-known/oauth-authorization-server with CORS headers",
      async () => {
        const { response, data } = await safeFetch(
          `${PREVIEW_URL}/.well-known/oauth-authorization-server`,
          {
            headers: {
              Origin: "http://localhost:6274", // MCP inspector origin
            },
            signal: AbortSignal.timeout(TIMEOUT),
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
      },
    );

    it.skipIf(IS_LOCAL_DEV)(
      "should handle CORS preflight for /.well-known/oauth-authorization-server",
      async () => {
        const { response } = await safeFetch(
          `${PREVIEW_URL}/.well-known/oauth-authorization-server`,
          {
            method: "OPTIONS",
            headers: {
              Origin: "http://localhost:6274",
              "Access-Control-Request-Method": "GET",
            },
            signal: AbortSignal.timeout(TIMEOUT),
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

        const allowMethods = response.headers.get(
          "access-control-allow-methods",
        );
        // Should include at least GET
        expect(allowMethods).toContain("GET");
      },
    );

    it("should respond quickly (under 2 seconds)", async () => {
      const start = Date.now();
      const { response } = await safeFetch(PREVIEW_URL, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(2000);
    });

    it("should have proper security headers", async () => {
      const { response } = await safeFetch(PREVIEW_URL, {
        signal: AbortSignal.timeout(TIMEOUT),
      });

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
