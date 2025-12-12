import { env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import app from "../../app";
import { SCOPES } from "../../../constants";
import type { Env } from "../../types";

/**
 * Integration tests for the MCP endpoint via OAuthProvider.
 *
 * These tests use the OAuthProvider directly (without Sentry wrapper)
 * to test the MCP endpoint authentication behavior.
 */

// Create a minimal MCP handler stub for testing OAuth behavior
// The actual MCP handler is tested in mcp-handler.test.ts
const mcpHandlerStub = {
  async fetch() {
    return new Response("MCP OK", { status: 200 });
  },
};

function createOAuthWrappedHandler() {
  return new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler: mcpHandlerStub,
    defaultHandler: app,
    authorizeEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: Object.keys(SCOPES),
  });
}

describe("MCP endpoint via OAuthProvider", () => {
  describe("without authentication", () => {
    it("should return 401 for unauthenticated requests to /mcp", async () => {
      const handler = createOAuthWrappedHandler();

      const request = new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      const mockCtx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      };

      const response = await handler.fetch(
        request,
        env as unknown as Env,
        mockCtx as unknown as ExecutionContext,
      );

      // OAuthProvider should return 401 for unauthenticated API requests
      expect(response.status).toBe(401);
    });

    it("should return 401 with invalid Bearer token", async () => {
      const handler = createOAuthWrappedHandler();

      const request = new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-token-12345",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      const mockCtx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      };

      const response = await handler.fetch(
        request,
        env as unknown as Env,
        mockCtx as unknown as ExecutionContext,
      );

      // OAuthProvider should return 401 for invalid tokens
      expect(response.status).toBe(401);
    });
  });

  describe("OAuth discovery", () => {
    it("should return OAuth metadata at /.well-known/oauth-authorization-server", async () => {
      const handler = createOAuthWrappedHandler();

      const request = new Request(
        "http://localhost/.well-known/oauth-authorization-server",
        {
          method: "GET",
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
      );

      const mockCtx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      };

      const response = await handler.fetch(
        request,
        env as unknown as Env,
        mockCtx as unknown as ExecutionContext,
      );

      expect(response.status).toBe(200);
      const metadata = (await response.json()) as {
        authorization_endpoint: string;
        token_endpoint: string;
      };
      expect(metadata.authorization_endpoint).toContain("/oauth/authorize");
      expect(metadata.token_endpoint).toContain("/oauth/token");
    });
  });

  describe("OAuth client registration", () => {
    it("should allow dynamic client registration at /oauth/register", async () => {
      const handler = createOAuthWrappedHandler();

      const request = new Request("http://localhost/oauth/register", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: "Test Client",
          redirect_uris: ["http://localhost/callback"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });

      const mockCtx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      };

      const response = await handler.fetch(
        request,
        env as unknown as Env,
        mockCtx as unknown as ExecutionContext,
      );

      expect(response.status).toBe(201);
      const client = (await response.json()) as {
        client_id: string;
        client_name: string;
      };
      expect(client.client_id).toBeDefined();
      expect(client.client_name).toBe("Test Client");
    });
  });
});
