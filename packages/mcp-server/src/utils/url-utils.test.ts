import { describe, expect, it } from "vitest";
import { normalizeHost, extractHostname } from "./url-utils";

describe("url-utils", () => {
  describe("normalizeHost", () => {
    it("should add https:// to hostnames by default", () => {
      expect(normalizeHost("sentry.io")).toBe("https://sentry.io");
      expect(normalizeHost("example.com")).toBe("https://example.com");
    });

    it("should add https:// to hostnames with ports", () => {
      expect(normalizeHost("localhost:8000")).toBe("https://localhost:8000");
      expect(normalizeHost("example.com:3000")).toBe(
        "https://example.com:3000",
      );
    });

    it("should preserve existing https:// URLs", () => {
      expect(normalizeHost("https://sentry.io")).toBe("https://sentry.io");
      expect(normalizeHost("https://example.com:443")).toBe(
        "https://example.com:443",
      );
    });

    it("should preserve existing http:// URLs", () => {
      expect(normalizeHost("http://localhost:8000")).toBe(
        "http://localhost:8000",
      );
      expect(normalizeHost("http://example.com")).toBe("http://example.com");
    });

    it("should use custom default protocol when provided", () => {
      expect(normalizeHost("localhost:8000", "http")).toBe(
        "http://localhost:8000",
      );
      expect(normalizeHost("example.com", "http")).toBe("http://example.com");
    });
  });

  describe("extractHostname", () => {
    it("should extract hostname from full URLs", () => {
      expect(extractHostname("https://sentry.io")).toBe("sentry.io");
      expect(extractHostname("http://localhost:8000")).toBe("localhost:8000");
      expect(extractHostname("https://example.com:443")).toBe("example.com");
    });

    it("should return hostname as-is when no protocol", () => {
      expect(extractHostname("sentry.io")).toBe("sentry.io");
      expect(extractHostname("localhost:8000")).toBe("localhost:8000");
      expect(extractHostname("example.com:3000")).toBe("example.com:3000");
    });
  });
});
