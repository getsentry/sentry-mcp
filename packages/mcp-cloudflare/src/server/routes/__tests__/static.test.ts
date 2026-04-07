import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { installFetchMockHooks } from "../../../test-utils/fetch-mock-setup";
import app from "../../app";

installFetchMockHooks(fetchMock);

describe("static routes", () => {
  describe("GET /robots.txt", () => {
    it("should return correct robots.txt content", async () => {
      const res = await app.request(
        "/robots.txt",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
        env,
      );

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe(
        [
          "User-agent: *",
          "Allow: /$",
          "Allow: /.well-known/",
          "Allow: /mcp.json",
          "Allow: /llms.txt",
          "Disallow: /",
        ].join("\n"),
      );
    });
  });

  describe("GET /llms.txt", () => {
    it("should return correct llms.txt content", async () => {
      const res = await app.request(
        "/llms.txt",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
        env,
      );

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("# Sentry MCP Server");
      expect(text).toContain("Model Context Protocol");
      expect(text).toContain("http://localhost/mcp");
    });
  });

  describe("GET /sse", () => {
    it("should return deprecation message with 410 status", async () => {
      const res = await app.request(
        "/sse",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
        env,
      );

      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json).toEqual({
        error: "SSE transport has been removed",
        message:
          "The SSE transport endpoint is no longer supported. Please use the HTTP transport at /mcp instead.",
        migrationGuide: "https://mcp.sentry.dev",
      });
    });
  });
});
