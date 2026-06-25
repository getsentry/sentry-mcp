import { env } from "cloudflare:test";
import { afterEach, describe, it, expect, vi } from "vitest";
import app from "../../app";
import type { Env } from "../../types";

function createEnvWithOAuthKv(overrides?: {
  get?: ReturnType<typeof vi.fn>;
  put?: ReturnType<typeof vi.fn>;
}): Env {
  return {
    ...(env as Record<string, unknown>),
    OAUTH_KV: {
      get: overrides?.get ?? vi.fn().mockResolvedValue(null),
      put: overrides?.put ?? vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Env;
}

describe("/api/auth OAuth flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /.well-known/oauth-client/demo-chat.json", () => {
    it("returns the hosted chat CIMD document", async () => {
      const res = await app.request(
        "https://mcp.sentry.dev/.well-known/oauth-client/demo-chat.json",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
        env,
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        client_id: string;
        client_name: string;
        client_uri: string;
        redirect_uris: string[];
        grant_types: string[];
        response_types: string[];
        token_endpoint_auth_method: string;
      };
      expect(json).toMatchObject({
        client_id:
          "https://mcp.sentry.dev/.well-known/oauth-client/demo-chat.json",
        client_name: "Sentry MCP Demo Chat",
        client_uri: "https://mcp.sentry.dev",
        redirect_uris: ["https://mcp.sentry.dev/api/auth/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });
      expect(json.redirect_uris).not.toContain("https://mcp.sentry.dev/mcp");
    });
  });

  describe("GET /api/auth/authorize", () => {
    it("uses the hosted chat CIMD URL as client_id on HTTPS origins", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const testEnv = createEnvWithOAuthKv();

      const res = await app.request(
        "https://mcp.sentry.dev/api/auth/authorize",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
        testEnv,
      );

      expect(res.status).toBe(302);
      expect(fetchSpy).not.toHaveBeenCalled();
      const location = res.headers.get("Location");
      expect(location).toBeTruthy();
      const authUrl = new URL(location!);
      expect(authUrl.pathname).toBe("/oauth/authorize");
      expect(authUrl.searchParams.get("client_id")).toBe(
        "https://mcp.sentry.dev/.well-known/oauth-client/demo-chat.json",
      );
      expect(authUrl.searchParams.get("redirect_uri")).toBe(
        "https://mcp.sentry.dev/api/auth/callback",
      );
      expect(authUrl.searchParams.get("resource")).toBe(
        "https://mcp.sentry.dev/mcp",
      );
    });

    it("keeps Dynamic Client Registration fallback on local HTTP origins", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            client_id: "registered-chat-client",
            client_name: "Sentry MCP Chat Demo",
            redirect_uris: ["http://localhost/api/auth/callback"],
            token_endpoint_auth_method: "none",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
      const put = vi.fn().mockResolvedValue(undefined);
      const testEnv = createEnvWithOAuthKv({ put });

      const res = await app.request(
        "http://localhost/api/auth/authorize",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
        testEnv,
      );

      expect(res.status).toBe(302);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost/oauth/register");
      expect(put).toHaveBeenCalled();
      const location = res.headers.get("Location");
      expect(location).toBeTruthy();
      const authUrl = new URL(location!);
      expect(authUrl.searchParams.get("client_id")).toBe(
        "registered-chat-client",
      );
      expect(authUrl.searchParams.get("resource")).toBe("http://localhost/mcp");
    });
  });

  describe("GET /api/auth/callback", () => {
    it("should return 400 when state parameter is missing", async () => {
      const res = await app.request(
        "/api/auth/callback?code=test-code",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
        env,
      );

      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Authentication Failed");
      expect(html).toContain("Invalid state parameter");
    });

    it("should return 400 when state does not match stored state", async () => {
      const res = await app.request(
        "/api/auth/callback?code=test-code&state=wrong-state",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
            Cookie: "chat_oauth_state=different-state",
          },
        },
        env,
      );

      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Authentication Failed");
      expect(html).toContain("Invalid state parameter");
    });

    it("should return 400 when code is missing but state is valid", async () => {
      const state = "valid-state-12345";
      const res = await app.request(
        `/api/auth/callback?state=${state}`,
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
            Cookie: `chat_oauth_state=${state}`,
          },
        },
        env,
      );

      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Authentication Failed");
      expect(html).toContain("No authorization code received");
    });

    it("includes the MCP resource when exchanging the code for tokens", async () => {
      const state = "valid-state-12345";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );

      const res = await app.request(
        `https://mcp.sentry.dev/api/auth/callback?code=test-code&state=${state}`,
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
            Cookie: `chat_oauth_state=${state}`,
          },
        },
        createEnvWithOAuthKv(),
      );

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://mcp.sentry.dev/oauth/token",
      );
      const [, init] = fetchSpy.mock.calls[0];
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("client_id")).toBe(
        "https://mcp.sentry.dev/.well-known/oauth-client/demo-chat.json",
      );
      expect(body.get("resource")).toBe("https://mcp.sentry.dev/mcp");
    });
  });
});
