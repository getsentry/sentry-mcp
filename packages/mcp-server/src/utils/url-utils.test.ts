import { describe, expect, it } from "vitest";
import {
  validateSentryHostThrows,
  validateAndParseSentryUrlThrows,
  validateOpenAiBaseUrlThrows,
  getIssueUrl,
  getIssuesSearchUrl,
  getTraceUrl,
  getEventsExplorerUrl,
} from "./url-utils";

describe("url-utils", () => {
  describe("validateSentryHostThrows", () => {
    it("should accept valid hostnames", () => {
      expect(() => validateSentryHostThrows("sentry.io")).not.toThrow();
      expect(() => validateSentryHostThrows("example.com")).not.toThrow();
      expect(() => validateSentryHostThrows("localhost:8000")).not.toThrow();
      expect(() =>
        validateSentryHostThrows("sentry.example.com"),
      ).not.toThrow();
    });

    it("should reject hostnames with http protocol", () => {
      expect(() => validateSentryHostThrows("http://sentry.io")).toThrow(
        "SENTRY_HOST should only contain a hostname",
      );
      expect(() => validateSentryHostThrows("http://example.com:8000")).toThrow(
        "SENTRY_HOST should only contain a hostname",
      );
    });

    it("should reject hostnames with https protocol", () => {
      expect(() => validateSentryHostThrows("https://sentry.io")).toThrow(
        "SENTRY_HOST should only contain a hostname",
      );
      expect(() => validateSentryHostThrows("https://example.com:443")).toThrow(
        "SENTRY_HOST should only contain a hostname",
      );
    });
  });

  describe("validateOpenAiBaseUrlThrows", () => {
    it("should accept valid HTTPS URLs", () => {
      expect(() =>
        validateOpenAiBaseUrlThrows("https://api.openai.com/v1"),
      ).not.toThrow();
      expect(() =>
        validateOpenAiBaseUrlThrows(
          "https://custom.example.com/openai/deployments/model",
        ),
      ).not.toThrow();
    });

    it("should accept valid HTTP URLs for local development", () => {
      expect(() =>
        validateOpenAiBaseUrlThrows("http://localhost:8080/v1"),
      ).not.toThrow();
    });

    it("should reject empty strings", () => {
      expect(() => validateOpenAiBaseUrlThrows(" ")).toThrow(
        "OPENAI base URL must not be empty.",
      );
    });

    it("should reject URLs with unsupported protocols", () => {
      expect(() => validateOpenAiBaseUrlThrows("ftp://example.com")).toThrow(
        "OPENAI base URL must use http or https scheme",
      );
    });

    it("should reject invalid URLs", () => {
      expect(() => validateOpenAiBaseUrlThrows("not-a-url")).toThrow(
        "OPENAI base URL must be a valid HTTP or HTTPS URL",
      );
    });
  });

  describe("validateAndParseSentryUrlThrows", () => {
    it("should accept and parse valid HTTPS URLs", () => {
      expect(validateAndParseSentryUrlThrows("https://sentry.io")).toBe(
        "sentry.io",
      );
      expect(validateAndParseSentryUrlThrows("https://example.com")).toBe(
        "example.com",
      );
      expect(validateAndParseSentryUrlThrows("https://localhost:8000")).toBe(
        "localhost:8000",
      );
      expect(
        validateAndParseSentryUrlThrows("https://sentry.example.com"),
      ).toBe("sentry.example.com");
      expect(validateAndParseSentryUrlThrows("https://example.com:443")).toBe(
        "example.com",
      );
    });

    it("should reject URLs without protocol", () => {
      expect(() => validateAndParseSentryUrlThrows("sentry.io")).toThrow(
        "SENTRY_URL must be a full HTTPS URL",
      );
      expect(() => validateAndParseSentryUrlThrows("example.com")).toThrow(
        "SENTRY_URL must be a full HTTPS URL",
      );
    });

    it("should reject HTTP URLs", () => {
      expect(() => validateAndParseSentryUrlThrows("http://sentry.io")).toThrow(
        "SENTRY_URL must be a full HTTPS URL",
      );
      expect(() =>
        validateAndParseSentryUrlThrows("http://example.com:8000"),
      ).toThrow("SENTRY_URL must be a full HTTPS URL");
    });

    it("should reject invalid URLs", () => {
      expect(() => validateAndParseSentryUrlThrows("https://")).toThrow(
        "SENTRY_URL must be a valid HTTPS URL",
      );
      expect(() =>
        validateAndParseSentryUrlThrows("https://[invalid-bracket"),
      ).toThrow("SENTRY_URL must be a valid HTTPS URL");
    });
  });

  describe("getIssueUrl", () => {
    it("should handle regional URLs correctly for SaaS", () => {
      const result = getIssueUrl("us.sentry.io", "myorg", "PROJ-123");
      expect(result).toBe("https://myorg.sentry.io/issues/PROJ-123");
    });

    it("should handle EU regional URLs correctly", () => {
      const result = getIssueUrl("eu.sentry.io", "myorg", "PROJ-456");
      expect(result).toBe("https://myorg.sentry.io/issues/PROJ-456");
    });

    it("should handle standard sentry.io correctly", () => {
      const result = getIssueUrl("sentry.io", "myorg", "PROJ-789");
      expect(result).toBe("https://myorg.sentry.io/issues/PROJ-789");
    });

    it("should handle self-hosted correctly", () => {
      const result = getIssueUrl("sentry.example.com", "myorg", "PROJ-123");
      expect(result).toBe(
        "https://sentry.example.com/organizations/myorg/issues/PROJ-123",
      );
    });
  });

  describe("getIssuesSearchUrl", () => {
    it("should handle regional URLs correctly for SaaS", () => {
      const result = getIssuesSearchUrl(
        "us.sentry.io",
        "myorg",
        "is:unresolved",
        "proj1",
      );
      expect(result).toBe(
        "https://myorg.sentry.io/issues/?project=proj1&query=is%3Aunresolved",
      );
    });

    it("should handle EU regional URLs correctly", () => {
      const result = getIssuesSearchUrl("eu.sentry.io", "myorg", "is:resolved");
      expect(result).toBe(
        "https://myorg.sentry.io/issues/?query=is%3Aresolved",
      );
    });

    it("should handle self-hosted correctly", () => {
      const result = getIssuesSearchUrl(
        "sentry.example.com",
        "myorg",
        "is:unresolved",
        "proj1",
      );
      expect(result).toBe(
        "https://sentry.example.com/organizations/myorg/issues/?project=proj1&query=is%3Aunresolved",
      );
    });
  });

  describe("getTraceUrl", () => {
    it("should handle regional URLs correctly for SaaS", () => {
      const result = getTraceUrl("us.sentry.io", "myorg", "abc123def456");
      expect(result).toBe(
        "https://myorg.sentry.io/explore/traces/trace/abc123def456",
      );
    });

    it("should handle EU regional URLs correctly", () => {
      const result = getTraceUrl("eu.sentry.io", "myorg", "xyz789");
      expect(result).toBe(
        "https://myorg.sentry.io/explore/traces/trace/xyz789",
      );
    });

    it("should handle self-hosted correctly", () => {
      const result = getTraceUrl("sentry.example.com", "myorg", "abc123");
      expect(result).toBe(
        "https://sentry.example.com/organizations/myorg/explore/traces/trace/abc123",
      );
    });
  });

  describe("getEventsExplorerUrl", () => {
    it("should handle regional URLs correctly for SaaS", () => {
      const result = getEventsExplorerUrl(
        "us.sentry.io",
        "myorg",
        "level:error",
        "errors",
        "proj1",
      );
      expect(result).toBe(
        "https://myorg.sentry.io/explore/?query=level%3Aerror&dataset=errors&layout=table&project=proj1",
      );
    });

    it("should handle EU regional URLs correctly", () => {
      const result = getEventsExplorerUrl(
        "eu.sentry.io",
        "myorg",
        "level:warning",
        "spans",
      );
      expect(result).toBe(
        "https://myorg.sentry.io/explore/?query=level%3Awarning&dataset=spans&layout=table",
      );
    });

    it("should handle self-hosted correctly", () => {
      const result = getEventsExplorerUrl(
        "sentry.example.com",
        "myorg",
        "level:error",
        "logs",
        "proj1",
      );
      expect(result).toBe(
        "https://sentry.example.com/organizations/myorg/explore/?query=level%3Aerror&dataset=logs&layout=table&project=proj1",
      );
    });
  });
});
