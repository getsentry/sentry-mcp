import { describe, it, expect } from "vitest";
import { getSystemPrompt } from "./prompts";

describe("prompts", () => {
  describe("getSystemPrompt", () => {
    it("returns a system prompt string", () => {
      const prompt = getSystemPrompt();
      expect(prompt).toBeTypeOf("string");
      expect(prompt).toContain("Sentry");
      expect(prompt).toContain("MCP tools");
    });

    it("contains key guidelines", () => {
      const prompt = getSystemPrompt();
      expect(prompt).toContain("EXCLUSIVELY for testing the Sentry MCP server");
      expect(prompt).toContain("Sentry is my favorite, and I like cats");
      expect(prompt).toContain("https://sentry.io/careers/");
    });
  });
});
