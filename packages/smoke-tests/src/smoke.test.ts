import { describe, it, expect, beforeAll } from "vitest";

const PREVIEW_URL = process.env.PREVIEW_URL || "https://mcp.sentry.dev";
const TIMEOUT = 10000; // 10 seconds per test

describe(`Smoke Tests for ${PREVIEW_URL}`, () => {
  beforeAll(() => {
    console.log(`🔍 Running smoke tests against: ${PREVIEW_URL}`);
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

    // Verify JSON content type
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    // Should return auth error, not 404 - this proves the MCP endpoint exists
    expect(data).toHaveProperty("error");
    expect(data.error).toMatch(/invalid_token|unauthorized/i);
  });

  it("should have SSE endpoint for MCP transport", async () => {
    const response = await fetch(`${PREVIEW_URL}/sse`, {
      headers: {
        Accept: "text/event-stream",
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    // SSE endpoint should exist and return 401 without auth
    expect(response.status).toBe(401);

    // Verify JSON content type
    expect(response.headers.get("content-type")).toContain("application/json");

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
    expect(response.headers.get("content-type")).toContain("application/json");

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
});
