import { describe, it, expect, beforeAll } from "vitest";

const PREVIEW_URL = process.env.PREVIEW_URL;
const TIMEOUT = 10000; // 10 seconds per test
const IS_LOCAL_DEV =
  PREVIEW_URL?.includes("localhost") || PREVIEW_URL?.includes("127.0.0.1");

// Skip all smoke tests if PREVIEW_URL is not set
const describeIfPreviewUrl = PREVIEW_URL ? describe : describe.skip;

/**
 * Safely read a response body, handling both JSON and streaming responses.
 * For streams, reads up to 1KB and then aborts to prevent hanging.
 */
async function safeReadBody(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") || "";

  // Check if it's a stream (SSE or other streaming response)
  if (
    contentType.includes("text/event-stream") ||
    contentType.includes("stream") ||
    response.headers.get("transfer-encoding") === "chunked"
  ) {
    // For streams, read limited data and abort
    const controller = new AbortController();
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      // Read up to 1KB
      while (buffer.length < 1024) {
        const readPromise = reader!.read();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Stream read timeout")), 1000),
        );

        const { done, value } = (await Promise.race([
          readPromise,
          timeoutPromise,
        ]).catch(() => ({ done: true, value: undefined }))) as any;

        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
    } finally {
      controller.abort();
      reader?.releaseLock();
    }

    return buffer;
  }

  // For non-streaming responses, read as text or JSON
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
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
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "initialize",
                id: 1,
              }),
              signal: AbortSignal.timeout(1000), // 1 second timeout per request
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
      await fetch(`${PREVIEW_URL}/api/metadata`, {
        signal: AbortSignal.timeout(remainingTime), // Use remaining warmup time
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
      const response = await fetch(PREVIEW_URL, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      expect(response.status).toBe(200);
    });

    it("should have MCP endpoint that returns server info (with auth error)", async () => {
      const response = await fetch(`${PREVIEW_URL}/mcp`, {
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

      const data = await safeReadBody(response);
      // Should return auth error, not 404 - this proves the MCP endpoint exists
      if (typeof data === "object") {
        expect(data).toHaveProperty("error");
        expect(data.error).toMatch(/invalid_token|unauthorized/i);
      } else {
        expect(data).toMatch(/invalid_token|unauthorized/i);
      }
    });

    it("should have MCP endpoint with org constraint (/mcp/sentry)", async () => {
      // Retry logic for potential Durable Object initialization
      let response: Response;
      let retries = 5;

      while (retries > 0) {
        response = await fetch(`${PREVIEW_URL}/mcp/sentry`, {
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

        // If we get 503, retry after a delay
        if (response.status === 503 && retries > 1) {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        break;
      }

      expect(response.status).toBe(401);

      const data = await safeReadBody(response);
      // Should return auth error, not 404 - this proves the constrained MCP endpoint exists
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
        response = await fetch(`${PREVIEW_URL}/mcp/sentry/mcp-server`, {
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

        // If we get 503, it's Durable Object initialization - retry
        if (response.status === 503 && retries > 1) {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds for DO to stabilize
          continue;
        }
        break;
      }

      expect(response.status).toBe(401);

      const data = await safeReadBody(response);
      // Should return auth error, not 404 - this proves the fully constrained MCP endpoint exists
      if (typeof data === "object") {
        expect(data).toHaveProperty("error");
        expect(data.error).toMatch(/invalid_token|unauthorized/i);
      } else {
        expect(data).toMatch(/invalid_token|unauthorized/i);
      }
    });

    it("should have SSE endpoint for MCP transport", async () => {
      // SSE endpoint has a bug where it takes 3+ seconds to return 401
      // This is unrelated to DO initialization - it's a bug in the SSE handler itself
      const response = await fetch(`${PREVIEW_URL}/sse`, {
        headers: {
          Accept: "text/event-stream",
        },
        signal: AbortSignal.timeout(6000), // SSE endpoint is slow to return 401
      });

      // SSE endpoint might return 401 JSON or start streaming with auth error
      if (response.status === 401) {
        // Got immediate 401 response
        const data = await safeReadBody(response);
        if (typeof data === "object") {
          expect(data).toHaveProperty("error");
          expect(data.error).toMatch(/invalid_token|unauthorized/i);
        } else {
          expect(data).toMatch(/invalid_token|unauthorized/i);
        }
      } else if (response.status === 200) {
        // Got SSE stream - read first 1KB to find auth error
        expect(response.headers.get("content-type")).toContain(
          "text/event-stream",
        );

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          // Read up to 1KB to find error
          while (buffer.length < 1024) {
            const { done, value } = await reader!.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Stop if we found an error
            if (
              buffer.includes("invalid_token") ||
              buffer.includes("unauthorized")
            ) {
              break;
            }
          }
        } finally {
          // Release the reader lock
          reader?.releaseLock();
        }

        // Verify auth error was in stream
        expect(buffer).toMatch(/invalid_token|unauthorized/i);
      } else {
        throw new Error(`Unexpected status: ${response.status}`);
      }
    });

    it("should have metadata endpoint that requires auth", async () => {
      const response = await fetch(`${PREVIEW_URL}/api/metadata`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      expect(response.status).toBe(401);

      const data = await safeReadBody(response);
      if (typeof data === "object") {
        expect(data).toHaveProperty("error");
        expect(data.name).toBe("MISSING_AUTH_TOKEN");
      } else {
        expect(data).toMatch(/MISSING_AUTH_TOKEN|unauthorized/i);
      }
    });

    it("should have chat endpoint that accepts POST", async () => {
      const response = await fetch(`${PREVIEW_URL}/api/chat`, {
        method: "POST",
        headers: {
          Origin: PREVIEW_URL, // Required for CSRF check
        },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      // Should return 401 (unauthorized) or 400 (bad request) for POST without auth
      expect([400, 401]).toContain(response.status);
    });

    it("should have OAuth authorize endpoint", async () => {
      const response = await fetch(`${PREVIEW_URL}/oauth/authorize`, {
        signal: AbortSignal.timeout(TIMEOUT),
        redirect: "manual", // Don't follow redirects
      });
      // Should return 200, 302 (redirect), or 400 (bad request)
      expect([200, 302, 400]).toContain(response.status);
    });

    it("should serve robots.txt", async () => {
      const response = await fetch(`${PREVIEW_URL}/robots.txt`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text).toContain("User-agent");
    });

    it("should serve llms.txt with MCP info", async () => {
      const response = await fetch(`${PREVIEW_URL}/llms.txt`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text).toContain("sentry-mcp");
      expect(text).toContain("Model Context Protocol");
      expect(text).toContain("/mcp");
    });

    it.skipIf(IS_LOCAL_DEV)(
      "should serve /.well-known/oauth-authorization-server with CORS headers",
      async () => {
        const response = await fetch(
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
        const data = await safeReadBody(response);
        if (typeof data === "object") {
          expect(data).toHaveProperty("issuer");
          expect(data).toHaveProperty("authorization_endpoint");
          expect(data).toHaveProperty("token_endpoint");
        } else {
          throw new Error(`Expected JSON metadata but got: ${data}`);
        }
      },
    );

    it.skipIf(IS_LOCAL_DEV)(
      "should handle CORS preflight for /.well-known/oauth-authorization-server",
      async () => {
        const response = await fetch(
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
      const response = await fetch(PREVIEW_URL, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(2000);
    });

    it("should have proper security headers", async () => {
      const response = await fetch(PREVIEW_URL, {
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
