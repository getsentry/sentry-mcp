import { describe, it, expect } from "vitest";
import { buildServer } from "./server";

describe("server context resolution", () => {
  describe("buildServer", () => {
    it("creates server successfully", () => {
      const server = buildServer();

      // Server should be created and configured successfully
      expect(server).toBeDefined();
    });

    it("accepts onToolComplete callback", () => {
      let callbackExecuted = false;

      const server = buildServer({
        onToolComplete: () => {
          callbackExecuted = true;
        },
      });

      // The callback should be set up (actual execution happens after tool calls)
      expect(server).toBeDefined();
    });
  });
});
