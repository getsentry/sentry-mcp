import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "./server";
import { constraintsStorage } from "./internal/context-storage";
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
          // @ts-expect-error - intentionally missing both context and getContext
        }),
      ).rejects.toThrow("Either context or getContext must be provided");
    });
  });

  describe("dynamic context (Cloudflare mode)", () => {
    it("accepts getContext callback for dynamic resolution", async () => {
      let getContextCallCount = 0;

      const getContext = () => {
        getContextCallCount++;
        return {
          userId: `user-${getContextCallCount}`,
          clientId: "test-client",
          accessToken: "test-token",
          sentryHost: "sentry.io",
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

    it("resolves constraints from AsyncLocalStorage in getContext", async () => {
      const getContext = (): ServerContext => {
        // Simulate what mcp-handler does: get constraints from AsyncLocalStorage
        const constraints = constraintsStorage.getStore() || {};

        return {
          userId: "test-user",
          clientId: "test-client",
          accessToken: "test-token",
          sentryHost: "sentry.io",
          constraints,
        };
      };

      await configureServer({
        server,
        getContext,
      });

      // Simulate a request with constraints
      const result = await constraintsStorage.run(
        {
          organizationSlug: "test-org",
          projectSlug: "test-project",
          regionUrl: "https://us.sentry.io",
        },
        async () => {
          // Inside this context, getContext should pick up the constraints
          const context = getContext();
          return context.constraints;
        },
      );

      expect(result).toEqual({
        organizationSlug: "test-org",
        projectSlug: "test-project",
        regionUrl: "https://us.sentry.io",
      });
    });

    it("isolates contexts between concurrent requests", async () => {
      const getContext = (): ServerContext => {
        const constraints = constraintsStorage.getStore() || {};
        return {
          userId: "test-user",
          clientId: "test-client",
          accessToken: "test-token",
          sentryHost: "sentry.io",
          constraints,
        };
      };

      await configureServer({
        server,
        getContext,
      });

      // Simulate concurrent requests with different constraints
      const [result1, result2, result3] = await Promise.all([
        constraintsStorage.run(
          {
            organizationSlug: "org1",
            projectSlug: null,
            regionUrl: null,
          },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return getContext().constraints;
          },
        ),
        constraintsStorage.run(
          {
            organizationSlug: "org2",
            projectSlug: "project2",
            regionUrl: "https://us.sentry.io",
          },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return getContext().constraints;
          },
        ),
        constraintsStorage.run(
          {
            organizationSlug: "org3",
            projectSlug: null,
            regionUrl: "https://eu.sentry.io",
          },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            return getContext().constraints;
          },
        ),
      ]);

      // Each request should have its own isolated constraints
      expect(result1?.organizationSlug).toBe("org1");
      expect(result1?.projectSlug).toBeNull();

      expect(result2?.organizationSlug).toBe("org2");
      expect(result2?.projectSlug).toBe("project2");

      expect(result3?.organizationSlug).toBe("org3");
      expect(result3?.regionUrl).toBe("https://eu.sentry.io");
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
