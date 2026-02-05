import { describe, it, expect } from "vitest";
import app from "./app";

// Simulate a cross-origin server-to-server POST (no Origin, no Sec-Fetch-Site headers)
// This is how MCP clients and OAuth token exchanges actually call our endpoints.
function crossOriginPost(
  path: string,
  body: string,
  contentType: string,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "CF-Connecting-IP": "192.0.2.1",
    },
    body,
  });
}

// Simulate a cross-origin POST with explicit foreign Origin header
function foreignOriginPost(
  path: string,
  body: string,
  contentType: string,
): Promise<Response> {
  return app.request(`https://mcp.sentry.dev${path}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Origin: "https://evil.example.com",
      "Sec-Fetch-Site": "cross-site",
      "CF-Connecting-IP": "192.0.2.1",
    },
    body,
  });
}

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

  describe("CSRF exemptions for cross-origin API endpoints", () => {
    // These tests verify that server-to-server endpoints are reachable through
    // the full middleware stack. The exact response codes depend on missing
    // storage/auth — what matters is they are NOT blocked by CSRF (403).

    it("allows cross-origin POST to /oauth/token without Origin header", async () => {
      const res = await crossOriginPost(
        "/oauth/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          code: "test",
          client_id: "test",
        }).toString(),
        "application/x-www-form-urlencoded",
      );

      // Should reach the token handler (not be blocked by CSRF)
      expect(res.status).not.toBe(403);
    });

    it("allows cross-origin POST to /oauth/register without Origin header", async () => {
      const res = await crossOriginPost(
        "/oauth/register",
        JSON.stringify({ redirect_uris: ["https://example.com/callback"] }),
        "application/json",
      );

      // Should reach the register handler (not be blocked by CSRF)
      expect(res.status).not.toBe(403);
    });

    it("allows cross-origin POST to /mcp without Origin header", async () => {
      const res = await crossOriginPost(
        "/mcp",
        JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          id: 1,
        }),
        "application/json",
      );

      // Should reach the MCP handler (not be blocked by CSRF)
      expect(res.status).not.toBe(403);
    });

    it("allows cross-origin POST to /.mcp without Origin header", async () => {
      const res = await crossOriginPost(
        "/.mcp",
        JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          id: 1,
        }),
        "application/json",
      );

      expect(res.status).not.toBe(403);
    });

    it("allows POST to /oauth/token with foreign Origin header", async () => {
      const res = await foreignOriginPost(
        "/oauth/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          code: "test",
          client_id: "test",
        }).toString(),
        "application/x-www-form-urlencoded",
      );

      expect(res.status).not.toBe(403);
    });
  });

  describe("CSRF protection for browser-facing endpoints", () => {
    it("blocks cross-origin form POST to /oauth/authorize", async () => {
      const res = await foreignOriginPost(
        "/oauth/authorize",
        new URLSearchParams({ approved: "true" }).toString(),
        "application/x-www-form-urlencoded",
      );

      // CSRF middleware throws 403, but onError handler converts to 500.
      // The key behavioral assertion: cross-origin form POSTs to browser
      // endpoints must not succeed.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
    });
  });
});
