import { describe, expect, it } from "vitest";
import {
  parseResourceExperimentalMode,
  parseResourceMcpConstraints,
} from "./resource-scope";

describe("resource-scope", () => {
  describe("parseResourceMcpConstraints", () => {
    it("parses organization and project constraints from MCP resource URLs", () => {
      expect(
        parseResourceMcpConstraints("https://example.com/mcp/sentry/frontend"),
      ).toEqual({
        organizationSlug: "sentry",
        projectSlug: "frontend",
      });
    });
  });

  describe("parseResourceExperimentalMode", () => {
    it("detects experimental MCP resource URLs", () => {
      expect(
        parseResourceExperimentalMode(
          "https://example.com/mcp/sentry/frontend?experimental=1",
        ),
      ).toBe(true);
    });

    it("returns false for stable or invalid resource URLs", () => {
      expect(
        parseResourceExperimentalMode("https://example.com/mcp/sentry"),
      ).toBe(false);
      expect(parseResourceExperimentalMode("not a url")).toBe(false);
    });
  });
});
