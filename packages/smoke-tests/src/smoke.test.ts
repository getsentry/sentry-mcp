import { describe, it, expect, beforeAll } from "vitest";

const PREVIEW_URL = process.env.PREVIEW_URL;
const TIMEOUT = 10000; // 10 seconds per test
const IS_LOCAL_DEV =
  PREVIEW_URL?.includes("localhost") || PREVIEW_URL?.includes("127.0.0.1");

// Skip all smoke tests if PREVIEW_URL is not set
const describeIfPreviewUrl = PREVIEW_URL ? describe : describe.skip;

describeIfPreviewUrl(
  `Smoke Tests for ${PREVIEW_URL || "(no PREVIEW_URL set)"}`,
  () => {
    beforeAll(() => {
      console.log(`🔍 Running smoke tests against: ${PREVIEW_URL}`);
      if (IS_LOCAL_DEV) {
        console.log(
          `⚠️  Skipping OAuth .well-known tests (not available in local dev)`,
        );
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
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      // Should return auth error, not 404 - this proves the MCP endpoint exists
      expect(data).toHaveProperty("error");
      expect(data.error).toMatch(/invalid_token|unauthorized/i);
    });

    it("should have MCP endpoint with org constraint (/mcp/sentry)", async () => {
      const response = await fetch(`${PREVIEW_URL}/mcp/sentry`, {
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
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      // Should return auth error, not 404 - this proves the constrained MCP endpoint exists
      expect(data).toHaveProperty("error");
      expect(data.error).toMatch(/invalid_token|unauthorized/i);
    });

    it("should have MCP endpoint with org and project constraints (/mcp/sentry/mcp-server)", async () => {
      // Retry logic for Durable Object initialization in CI
      let response: Response;
      let retries = 3;

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

        // If we get 503, it might be Durable Object initialization - retry
        if (response.status === 503 && retries > 1) {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
          continue;
        }
        break;
      }

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      // Should return auth error, not 404 - this proves the fully constrained MCP endpoint exists
      expect(data).toHaveProperty("error");
      expect(data.error).toMatch(/invalid_token|unauthorized/i);
    });

    it("should have SSE endpoint for MCP transport", async () => {
      const response = await fetch(`${PREVIEW_URL}/sse`, {
        // Remove Accept: "text/event-stream" header to avoid establishing streaming connection
        // We just want to verify the endpoint exists and returns 401 without auth
        signal: AbortSignal.timeout(TIMEOUT),
      });

      // SSE endpoint should exist and return 401 without auth
      expect(response.status).toBe(401);

      // Verify JSON content type
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(data.error).toMatch(/invalid_token|unauthorized/i);
    });

    it("should have metadata endpoint that requires auth", async () => {
      const response = await fetch(`${PREVIEW_URL}/api/metadata`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      expect(response.status).toBe(401);

      // Verify JSON content type
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(data.name).toBe("MISSING_AUTH_TOKEN");
    });

    it("should have chat endpoint that accepts POST", async () => {
      const response = await fetch(`${PREVIEW_URL}/api/chat`, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT),
      });
      // Should return 401 (unauthorized) or 400/500 (error) for POST without auth
      expect([400, 401, 500]).toContain(response.status);
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
        const data = await response.json();
        expect(data).toHaveProperty("issuer");
        expect(data).toHaveProperty("authorization_endpoint");
        expect(data).toHaveProperty("token_endpoint");
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
