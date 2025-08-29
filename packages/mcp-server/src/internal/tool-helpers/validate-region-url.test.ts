import { describe, it, expect } from "vitest";
import { validateRegionUrl } from "./validate-region-url";
import { UserInputError } from "../../errors";

describe("validateRegionUrl", () => {
  describe("sentry.io validation", () => {
    it("allows exact match for sentry.io", () => {
      const result = validateRegionUrl("https://sentry.io", "sentry.io");
      expect(result).toBe("sentry.io");
    });

    it("allows us.sentry.io for sentry.io base", () => {
      const result = validateRegionUrl("https://us.sentry.io", "sentry.io");
      expect(result).toBe("us.sentry.io");
    });

    it("allows de.sentry.io for sentry.io base", () => {
      const result = validateRegionUrl("https://de.sentry.io", "sentry.io");
      expect(result).toBe("de.sentry.io");
    });

    it("rejects unknown region subdomains for sentry.io", () => {
      expect(() =>
        validateRegionUrl("https://evil.sentry.io", "sentry.io"),
      ).toThrow(UserInputError);
      expect(() =>
        validateRegionUrl("https://evil.sentry.io", "sentry.io"),
      ).toThrow("Allowed regions for sentry.io are: us, de");
    });

    it("rejects completely different domains for sentry.io", () => {
      expect(() => validateRegionUrl("https://evil.com", "sentry.io")).toThrow(
        UserInputError,
      );
      expect(() => validateRegionUrl("https://evil.com", "sentry.io")).toThrow(
        "For sentry.io, regionUrl must be sentry.io or [region].sentry.io",
      );
    });

    it("handles http protocol for sentry.io", () => {
      const result = validateRegionUrl("http://us.sentry.io", "sentry.io");
      expect(result).toBe("us.sentry.io");
    });
  });

  describe("self-hosted validation", () => {
    it("allows exact match for self-hosted", () => {
      const result = validateRegionUrl(
        "https://sentry.company.com",
        "sentry.company.com",
      );
      expect(result).toBe("sentry.company.com");
    });

    it("allows subdomain for self-hosted", () => {
      const result = validateRegionUrl(
        "https://eu.sentry.company.com",
        "sentry.company.com",
      );
      expect(result).toBe("eu.sentry.company.com");
    });

    it("allows nested subdomains for self-hosted", () => {
      const result = validateRegionUrl(
        "https://region.eu.sentry.company.com",
        "sentry.company.com",
      );
      expect(result).toBe("region.eu.sentry.company.com");
    });

    it("rejects different domains for self-hosted", () => {
      expect(() =>
        validateRegionUrl("https://evil.com", "sentry.company.com"),
      ).toThrow(UserInputError);
      expect(() =>
        validateRegionUrl("https://evil.com", "sentry.company.com"),
      ).toThrow(
        "The regionUrl host must be sentry.company.com or a subdomain of sentry.company.com",
      );
    });

    it("rejects parent domains for self-hosted", () => {
      expect(() =>
        validateRegionUrl("https://company.com", "sentry.company.com"),
      ).toThrow(UserInputError);
    });
  });

  describe("protocol validation", () => {
    it("rejects URLs without protocol", () => {
      expect(() => validateRegionUrl("sentry.io", "sentry.io")).toThrow(
        UserInputError,
      );
      expect(() => validateRegionUrl("sentry.io", "sentry.io")).toThrow(
        "Must be a valid URL",
      );
    });

    it("rejects non-http/https protocols", () => {
      expect(() => validateRegionUrl("ftp://sentry.io", "sentry.io")).toThrow(
        UserInputError,
      );
      expect(() => validateRegionUrl("ftp://sentry.io", "sentry.io")).toThrow(
        "Must include protocol (http:// or https://)",
      );
    });

    it("rejects malformed URLs", () => {
      expect(() => validateRegionUrl("https://", "sentry.io")).toThrow(
        UserInputError,
      );
      expect(() => validateRegionUrl("https://", "sentry.io")).toThrow(
        "Must be a valid URL",
      );
    });

    it("rejects protocol-only hosts", () => {
      expect(() => validateRegionUrl("https://https", "sentry.io")).toThrow(
        UserInputError,
      );
      expect(() => validateRegionUrl("https://https", "sentry.io")).toThrow(
        "The host cannot be just a protocol name",
      );
    });
  });

  describe("case sensitivity", () => {
    it("handles case-insensitive matching for sentry.io", () => {
      const result = validateRegionUrl("https://US.SENTRY.IO", "sentry.io");
      expect(result).toBe("us.sentry.io");
    });

    it("handles case-insensitive matching for self-hosted", () => {
      const result = validateRegionUrl(
        "https://SENTRY.COMPANY.COM",
        "sentry.company.com",
      );
      expect(result).toBe("sentry.company.com");
    });

    it("handles mixed case base host", () => {
      const result = validateRegionUrl("https://us.sentry.io", "SENTRY.IO");
      expect(result).toBe("us.sentry.io");
    });
  });

  describe("edge cases", () => {
    it("handles trailing slashes in URL", () => {
      const result = validateRegionUrl("https://us.sentry.io/", "sentry.io");
      expect(result).toBe("us.sentry.io");
    });

    it("handles URL with path", () => {
      const result = validateRegionUrl(
        "https://us.sentry.io/api/0/organizations/",
        "sentry.io",
      );
      expect(result).toBe("us.sentry.io");
    });

    it("handles URL with query params", () => {
      const result = validateRegionUrl(
        "https://us.sentry.io?test=1",
        "sentry.io",
      );
      expect(result).toBe("us.sentry.io");
    });

    it("handles URL with port", () => {
      const result = validateRegionUrl(
        "https://sentry.company.com:8080",
        "sentry.company.com:8080",
      );
      expect(result).toBe("sentry.company.com:8080");
    });

    it("rejects when port doesn't match", () => {
      expect(() =>
        validateRegionUrl(
          "https://sentry.company.com:8080",
          "sentry.company.com",
        ),
      ).toThrow(UserInputError);
    });
  });
});
