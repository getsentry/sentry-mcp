/**
 * Integration tests for the MCP Server Worker.
 *
 * These tests run in the actual Cloudflare Workers runtime using vitest-pool-workers.
 * They test the worker's HTTP endpoints without mocking.
 */
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("MCP Server Worker", () => {
  describe("GET /robots.txt", () => {
    it("returns correct robots.txt content", async () => {
      const response = await SELF.fetch("https://example.com/robots.txt");

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("User-agent: *");
      expect(text).toContain("Allow: /$");
      expect(text).toContain("Disallow: /");
    });
  });

  describe("GET /llms.txt", () => {
    it("returns correct llms.txt content", async () => {
      const response = await SELF.fetch("https://example.com/llms.txt");

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("# sentry-mcp");
      expect(text).toContain("Model Context Protocol");
    });
  });

  describe("GET /sse", () => {
    it("returns deprecation message with 410 status", async () => {
      const response = await SELF.fetch("https://example.com/sse");

      expect(response.status).toBe(410);
      const json = await response.json();
      expect(json).toMatchObject({
        error: "SSE transport has been removed",
        message: expect.stringContaining("no longer supported"),
      });
    });
  });

  describe("GET /.well-known/oauth-authorization-server", () => {
    it("returns OAuth metadata", async () => {
      const response = await SELF.fetch(
        "https://example.com/.well-known/oauth-authorization-server",
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toMatchObject({
        issuer: "https://example.com",
        authorization_endpoint: "https://example.com/oauth/authorize",
        token_endpoint: "https://example.com/oauth/token",
        registration_endpoint: "https://example.com/oauth/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        // OAuth provider supports both plain and S256 PKCE methods
        code_challenge_methods_supported: expect.arrayContaining(["S256"]),
      });
    });
  });

  describe("GET /.mcp/tools.json", () => {
    it("returns tool definitions", async () => {
      const response = await SELF.fetch("https://example.com/.mcp/tools.json");

      expect(response.status).toBe(200);
      // The endpoint returns an array of tools directly
      const tools = await response.json();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      // Verify tool structure
      const firstTool = tools[0];
      expect(firstTool).toHaveProperty("name");
      expect(firstTool).toHaveProperty("description");
      expect(firstTool).toHaveProperty("inputSchema");
    });
  });

  describe("MCP endpoints without auth", () => {
    it("returns 401 for unauthenticated /mcp requests", async () => {
      const response = await SELF.fetch("https://example.com/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      });

      // Should require authentication
      expect(response.status).toBe(401);
    });
  });
});
