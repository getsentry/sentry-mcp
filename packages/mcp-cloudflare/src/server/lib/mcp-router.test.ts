import { describe, it, expect } from "vitest";
import { parseMcpPath } from "./mcp-router";

describe("mcp-router", () => {
  describe("parseMcpPath", () => {
    it("should parse /mcp without constraints", () => {
      const result = parseMcpPath("/mcp");
      expect(result).toEqual({
        basePath: "/mcp",
        constraints: undefined,
      });
    });

    it("should parse /mcp/ with trailing slash", () => {
      const result = parseMcpPath("/mcp/");
      expect(result).toEqual({
        basePath: "/mcp",
        constraints: undefined,
      });
    });

    it("should parse /mcp/{org} with organization constraint", () => {
      const result = parseMcpPath("/mcp/acme-corp");
      expect(result).toEqual({
        basePath: "/mcp",
        constraints: {
          organizationSlug: "acme-corp",
        },
      });
    });

    it("should parse /mcp/{org}/ with trailing slash", () => {
      const result = parseMcpPath("/mcp/acme-corp/");
      expect(result).toEqual({
        basePath: "/mcp",
        constraints: {
          organizationSlug: "acme-corp",
        },
      });
    });

    it("should parse /mcp/{org}/{project} with both constraints", () => {
      const result = parseMcpPath("/mcp/acme-corp/frontend");
      expect(result).toEqual({
        basePath: "/mcp",
        constraints: {
          organizationSlug: "acme-corp",
          projectSlug: "frontend",
        },
      });
    });

    it("should parse /mcp/{org}/{project}/ with trailing slash", () => {
      const result = parseMcpPath("/mcp/acme-corp/frontend/");
      expect(result).toEqual({
        basePath: "/mcp",
        constraints: {
          organizationSlug: "acme-corp",
          projectSlug: "frontend",
        },
      });
    });

    it("should return null for too many segments", () => {
      const result = parseMcpPath("/mcp/org/project/extra");
      expect(result).toBeNull();
    });

    it("should return null for non-MCP paths", () => {
      expect(parseMcpPath("/api/search")).toBeNull();
      expect(parseMcpPath("/oauth/authorize")).toBeNull();
      expect(parseMcpPath("/")).toBeNull();
    });

    it("should parse /sse endpoint", () => {
      const result = parseMcpPath("/sse");
      expect(result).toEqual({
        basePath: "/sse",
        constraints: undefined,
      });
    });

    it("should parse /sse/ with trailing slash", () => {
      const result = parseMcpPath("/sse/");
      expect(result).toEqual({
        basePath: "/sse",
        constraints: undefined,
      });
    });

    it("should handle URL-encoded slugs", () => {
      const result = parseMcpPath("/mcp/acme%20corp/my%2Dproject");
      expect(result).toEqual({
        basePath: "/mcp",
        constraints: {
          organizationSlug: "acme%20corp",
          projectSlug: "my%2Dproject",
        },
      });
    });

    it("should handle hyphens and underscores in slugs", () => {
      const result = parseMcpPath("/mcp/acme-corp_2024/frontend_v2");
      expect(result).toEqual({
        basePath: "/mcp",
        constraints: {
          organizationSlug: "acme-corp_2024",
          projectSlug: "frontend_v2",
        },
      });
    });
  });
});
