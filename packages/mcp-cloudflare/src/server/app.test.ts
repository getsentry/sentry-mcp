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

  describe("GET /.well-known/oauth-protected-resource/mcp", () => {
    it("should return RFC 9728 protected resource metadata", async () => {
      const res = await app.request(
        "/.well-known/oauth-protected-resource/mcp",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
      );

      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({
        resource: "http://localhost/mcp",
        authorization_servers: ["http://localhost"],
      });
    });

    it("should return correct URLs for custom host", async () => {
      const res = await app.request(
        "https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
      );

      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({
        resource: "https://mcp.sentry.dev/mcp",
        authorization_servers: ["https://mcp.sentry.dev"],
      });
    });

    it("should handle dynamic subpaths", async () => {
      const res = await app.request(
        "https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp/sentry/mcp-server",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
      );

      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({
        resource: "https://mcp.sentry.dev/mcp/sentry/mcp-server",
        authorization_servers: ["https://mcp.sentry.dev"],
      });
    });

    it("should handle dynamic subpaths with query parameters", async () => {
      const res = await app.request(
        "https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp/sentry/mcp-server?experimental=1",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
      );

      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({
        resource: "https://mcp.sentry.dev/mcp/sentry/mcp-server",
        authorization_servers: ["https://mcp.sentry.dev"],
      });
    });
  });
});
