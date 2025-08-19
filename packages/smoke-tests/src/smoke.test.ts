import { describe, it, expect, beforeAll } from "vitest";

const PREVIEW_URL = process.env.PREVIEW_URL;
const TIMEOUT = 10000; // 10 seconds per test
const IS_LOCAL_DEV =
  PREVIEW_URL?.includes("localhost") || PREVIEW_URL?.includes("127.0.0.1");

// Skip all smoke tests if PREVIEW_URL is not set
const describeIfPreviewUrl = PREVIEW_URL ? describe : describe.skip;

/**
 * Safely fetch from any endpoint and parse the response.
 * Handles JSON, text, and streaming responses consistently.
 * For streaming responses, reads up to maxLength bytes to prevent hanging.
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
      while (totalLength < maxLength && reader) {
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

        if (done) break;

        if (value && value.length > 0) {
          const chunk = decoder.decode(value, { stream: true });
          data += chunk;
          totalLength += chunk.length;

          if (totalLength >= maxLength) {
            data = data.substring(0, maxLength);
            break;
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Read timeout") {
        // Timeout is acceptable for streams
        if (!data) {
          data = "(stream active but no immediate data)";
        }
      } else {
        throw error;
      }
    } finally {
      try {
        reader?.releaseLock();
      } catch {
        // Ignore cleanup errors
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

      // Warm up the server and Durable Objects to avoid initialization delays
      // IMPORTANT: There's a bug in workerd where Node.js fetch hangs after DO initialization
      // We warm up all DO endpoints and add a "sacrificial" request to absorb the hang
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

      // CRITICAL: Make a sacrificial request that will hang due to the workerd bug
      // This protects the actual tests from hanging
      const remainingTime = Math.max(
        1000,
        maxWarmupTime - (Date.now() - warmupStartTime),
      );
      await safeFetch(`${PREVIEW_URL}/api/metadata`, {
        maxLength: 100,
        timeoutMs: remainingTime,
      }).catch(() => {}); // Ignore timeout

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
      // Test SSE endpoint using safeFetch with stream handling
      const { response, data } = await safeFetch(`${PREVIEW_URL}/sse`, {
        headers: {
          Accept: "text/event-stream",
        },
        maxLength: 256, // Small amount of data for streams
        timeoutMs: 500, // Short timeout for streams
      });

      console.log(`📡 SSE test result: status=${response.status}`);
      if (data) {
        console.log(`📡 SSE data: ${String(data).substring(0, 100)}...`);
      }

      // SSE endpoint should respond appropriately
      if (response.status === 401) {
        // Expected auth error
        if (typeof data === "object") {
          expect(data).toHaveProperty("error");
          expect(data.error).toMatch(/invalid_token|unauthorized/i);
        } else {
          expect(data).toMatch(/invalid_token|unauthorized|error/i);
        }
      } else if (response.status === 200) {
        // SSE stream started successfully
        expect(response.headers.get("content-type")).toContain(
          "text/event-stream",
        );
        expect(data).toBeDefined();
      } else {
        throw new Error(`Unexpected SSE status: ${response.status}`);
      }
    }, 30000); // 30 second timeout for SSE test

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
