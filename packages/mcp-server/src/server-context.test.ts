import { describe, it, expect } from "vitest";
import { buildServer } from "./server";
import type { ServerContext } from "./types";

const mockContext: ServerContext = {
  accessToken: "test-token",
  sentryHost: "sentry.io",
  constraints: {},
};

describe("server context resolution", () => {
  describe("buildServer", () => {
    it("creates server successfully with context", () => {
      const server = buildServer({ context: mockContext });

      // Server should be created and configured successfully
      expect(server).toBeDefined();
    });

    it("accepts onToolComplete callback", () => {
      let callbackExecuted = false;

      const server = buildServer({
        context: mockContext,
        onToolComplete: () => {
          callbackExecuted = true;
        },
      });

      // The callback should be set up (actual execution happens after tool calls)
      expect(server).toBeDefined();
    });
  });
});
