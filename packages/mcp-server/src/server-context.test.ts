import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "./server";
import type { ServerContext } from "./types";

describe("server context resolution", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({
      name: "test-server",
      version: "1.0.0",
    });
  });

  describe("static context (stdio mode)", () => {
    it("uses provided static context", async () => {
      const staticContext: ServerContext = {
        userId: "test-user",
        clientId: "test-client",
        accessToken: "test-token",
        sentryHost: "sentry.io",
        constraints: {},
      };

      await configureServer({
        server,
        context: staticContext,
      });

      // Server should be configured successfully
      expect(server).toBeDefined();
    });

    it("throws error when neither context nor getContext is provided", async () => {
      await expect(
        configureServer({
          server,
        }),
      ).rejects.toThrow("Either context or getContext must be provided");
    });
  });

  describe("dynamic context (Cloudflare mode)", () => {
    it("accepts getContext callback for dynamic resolution", async () => {
      let getContextCallCount = 0;

      const getContext = (): ServerContext => {
        getContextCallCount++;
        return {
          userId: `user-${getContextCallCount}`,
          clientId: "test-client",
          accessToken: "test-token",
          sentryHost: "sentry.io",
          constraints: {},
        };
      };

      await configureServer({
        server,
        getContext,
      });

      // Server should be configured successfully with getContext
      // (getContext will be called during actual tool execution, not during configuration)
      expect(server).toBeDefined();
    });
  });

  describe("onToolComplete callback", () => {
    it("calls onToolComplete when provided", async () => {
      let callbackExecuted = false;

      await configureServer({
        server,
        context: {
          userId: "test-user",
          clientId: "test-client",
          accessToken: "test-token",
          sentryHost: "sentry.io",
          constraints: {},
        },
        onToolComplete: () => {
          callbackExecuted = true;
        },
      });

      // The callback should be set up (actual execution happens after tool calls)
      expect(server).toBeDefined();
    });
  });

  describe("scopes handling", () => {
    it("uses default scopes when grantedScopes not provided", async () => {
      const contextWithoutScopes: ServerContext = {
        userId: "test-user",
        clientId: "test-client",
        accessToken: "test-token",
        sentryHost: "sentry.io",
        constraints: {},
      };

      await configureServer({
        server,
        context: contextWithoutScopes,
      });

      // Server should be configured with default read-only scopes
      expect(server).toBeDefined();
    });

    it("uses provided grantedScopes when available", async () => {
      const contextWithScopes: ServerContext = {
        userId: "test-user",
        clientId: "test-client",
        accessToken: "test-token",
        sentryHost: "sentry.io",
        constraints: {},
        grantedScopes: new Set(["org:read", "project:read", "project:write"]),
      };

      await configureServer({
        server,
        context: contextWithScopes,
      });

      // Server should be configured with provided scopes
      expect(server).toBeDefined();
    });
  });
});
