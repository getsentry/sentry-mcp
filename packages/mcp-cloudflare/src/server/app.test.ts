import { describe, it, expect } from "vitest";
import app from "./app";

// RFC 5737 TEST-NET-1 address; required by the IP-extraction middleware
const TEST_HEADERS = { "CF-Connecting-IP": "192.0.2.1" } as const;

describe("app", () => {
  describe("GET /robots.txt", () => {
    it("should return correct robots.txt content", async () => {
      const res = await app.request("/robots.txt", {
        headers: TEST_HEADERS,
      });

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
    it("should return comprehensive llms.txt content", async () => {
      const res = await app.request("https://mcp.sentry.dev/llms.txt", {
        headers: TEST_HEADERS,
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");

      const text = await res.text();
      expect(text).toContain("# Sentry MCP Server");
      expect(text).toContain("https://mcp.sentry.dev/mcp");
      expect(text).toContain("{organizationSlug}");
      expect(text).toContain("{projectSlug}");
      expect(text).toContain("claude mcp add");
      expect(text).toContain("?experimental=1");
    });
  });

  describe("GET / with Accept: text/markdown", () => {
    it("should return llms.txt content when Accept includes text/markdown", async () => {
      const res = await app.request("https://mcp.sentry.dev/", {
        headers: { ...TEST_HEADERS, Accept: "text/markdown" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/markdown");

      const text = await res.text();
      expect(text).toContain("# Sentry MCP Server");
      expect(text).toContain("https://mcp.sentry.dev/mcp");
      expect(text).toContain("{organizationSlug}");
      expect(text).toContain("claude mcp add");
    });

    it("should fall through when Accept does not include text/markdown", async () => {
      const res = await app.request("https://mcp.sentry.dev/", {
        headers: { ...TEST_HEADERS, Accept: "text/html" },
      });

      // Falls through to SPA asset serving — in tests there's no static asset handler,
      // so we just verify it did NOT return the markdown content
      const text = await res.text();
      expect(text).not.toContain("# Sentry MCP Server");
    });
  });

  describe("GET /sse", () => {
    it("should return deprecation message with 410 status", async () => {
      const res = await app.request("/sse", {
        headers: TEST_HEADERS,
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

  describe("GET /.well-known/oauth-protected-resource", () => {
    it("should return RFC 9728 protected resource metadata for root", async () => {
      const res = await app.request(
        "https://mcp.sentry.dev/.well-known/oauth-protected-resource",
        { headers: TEST_HEADERS },
      );

      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({
        resource: "https://mcp.sentry.dev",
        authorization_servers: ["https://mcp.sentry.dev"],
      });
    });
  });

  describe("GET /.well-known/oauth-protected-resource/mcp", () => {
    it("should return RFC 9728 protected resource metadata", async () => {
      const res = await app.request(
        "/.well-known/oauth-protected-resource/mcp",
        { headers: TEST_HEADERS },
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
        { headers: TEST_HEADERS },
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
        { headers: TEST_HEADERS },
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
        { headers: TEST_HEADERS },
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
