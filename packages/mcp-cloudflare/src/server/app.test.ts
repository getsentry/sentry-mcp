import { describe, it, expect } from "vitest";
import app from "./app";

describe("app", () => {
  describe("GET /robots.txt", () => {
    it("should return correct robots.txt content", async () => {
      const res = await app.request("/robots.txt", {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
        },
      });

      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toBe(
        ["User-agent: *", "Allow: /$", "Disallow: /"].join("\n"),
      );
    });
  });

  describe("GET /llms.txt", () => {
    it("should return correct llms.txt content", async () => {
      const res = await app.request("/llms.txt", {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
        },
      });

      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain("# sentry-mcp");
      expect(text).toContain("Model Context Protocol");
    });
  });

  describe("GET /sse", () => {
    it("should return deprecation message with 410 status", async () => {
      const res = await app.request("/sse", {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
        },
      });

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
