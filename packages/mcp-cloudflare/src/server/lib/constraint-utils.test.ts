import { describe, it, expect } from "vitest";
import "urlpattern-polyfill";
import {
  isReservedEndpoint,
  extractConstraintsWithURLPattern,
} from "./constraint-utils";

describe("isReservedEndpoint", () => {
  it("should identify reserved SSE and MCP endpoints", () => {
    expect(isReservedEndpoint("/sse/message")).toBe(true);
    expect(isReservedEndpoint("/mcp/message")).toBe(true);
  });

  it("should identify reserved endpoints with query parameters", () => {
    expect(isReservedEndpoint("/sse/message?param=value")).toBe(true);
    expect(isReservedEndpoint("/mcp/message?foo=bar&baz=qux")).toBe(true);
  });

  it("should not identify non-reserved endpoints", () => {
    expect(isReservedEndpoint("/mcp")).toBe(false);
    expect(isReservedEndpoint("/mcp/org")).toBe(false);
    expect(isReservedEndpoint("/mcp/org/project")).toBe(false);
    expect(isReservedEndpoint("/api/something")).toBe(false);
    expect(isReservedEndpoint("/")).toBe(false);
  });
});

describe("extractConstraintsWithURLPattern", () => {
  describe("reserved endpoints", () => {
    it("should return null constraints for reserved SSE endpoints", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/sse/message",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: null,
        projectSlug: null,
      });
    });

    it("should return null constraints for reserved MCP endpoints", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/message",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: null,
        projectSlug: null,
      });
    });
  });

  describe("pattern matching", () => {
    it("should extract no constraints for base /mcp path", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: null,
        projectSlug: null,
      });
    });

    it("should extract organization slug for /mcp/:org pattern", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/sentry",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: "sentry",
        projectSlug: null,
      });
    });

    it("should extract both organization and project slugs for /mcp/:org/:project pattern", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/sentry/my-app",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: "sentry",
        projectSlug: "my-app",
      });
    });

    it("should handle URLs that don't match the pattern", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/api/something",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: null,
        projectSlug: null,
      });
    });
  });

  describe("slug validation", () => {
    it("should return error for invalid organization slug", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/invalid..slug",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: null,
        projectSlug: null,
        error: "Invalid organization slug format",
      });
    });

    it("should return error for invalid project slug", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/valid-org/invalid..project",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: null,
        projectSlug: null,
        error: "Invalid project slug format",
      });
    });

    it("should accept valid slugs with allowed characters", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/my-org_v2.1/test-project_123",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: "my-org_v2.1",
        projectSlug: "test-project_123",
      });
    });
  });

  describe("error handling", () => {
    it("should handle invalid URLPattern gracefully", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/org",
        "*{invalid",
      );
      expect(result).toEqual({
        organizationSlug: null,
        projectSlug: null,
        error: "Invalid URL pattern",
      });
    });

    it("should handle malformed URLs gracefully", () => {
      const result = extractConstraintsWithURLPattern(
        "not-a-valid-url",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: null,
        projectSlug: null,
        error: "Invalid URL pattern",
      });
    });
  });

  describe("query parameters and fragments", () => {
    it("should extract constraints from URLs with query parameters", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/sentry/my-project?param=value&foo=bar",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: "sentry",
        projectSlug: "my-project",
      });
    });

    it("should extract constraints from URLs with fragments", () => {
      const result = extractConstraintsWithURLPattern(
        "https://example.com/mcp/sentry#section",
        "/mcp/:org?/:project?",
      );
      expect(result).toEqual({
        organizationSlug: "sentry",
        projectSlug: null,
      });
    });
  });
});
