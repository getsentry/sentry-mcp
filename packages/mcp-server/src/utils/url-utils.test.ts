import { describe, expect, it } from "vitest";
import {
  validateSentryHostThrows,
  validateAndParseSentryUrlThrows,
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
});
