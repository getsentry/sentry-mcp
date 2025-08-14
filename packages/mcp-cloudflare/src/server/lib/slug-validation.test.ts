import { describe, it, expect } from "vitest";
import { isValidSlug } from "./slug-validation";

describe("isValidSlug", () => {
  describe("valid slugs", () => {
    it("should accept alphanumeric slugs", () => {
      expect(isValidSlug("test123")).toBe(true);
      expect(isValidSlug("ABC")).toBe(true);
      expect(isValidSlug("a")).toBe(true);
      expect(isValidSlug("9")).toBe(true);
    });

    it("should accept slugs with dots, dashes, and underscores", () => {
      expect(isValidSlug("test-project")).toBe(true);
      expect(isValidSlug("test_project")).toBe(true);
      expect(isValidSlug("test.project")).toBe(true);
      expect(isValidSlug("test-project_v2.1")).toBe(true);
    });

    it("should accept slugs up to 100 characters", () => {
      const maxSlug = "a".repeat(100);
      expect(isValidSlug(maxSlug)).toBe(true);
    });
  });

  describe("invalid slugs", () => {
    it("should reject empty strings", () => {
      expect(isValidSlug("")).toBe(false);
      expect(isValidSlug(null as any)).toBe(false);
      expect(isValidSlug(undefined as any)).toBe(false);
    });

    it("should reject slugs over 100 characters", () => {
      const longSlug = "a".repeat(101);
      expect(isValidSlug(longSlug)).toBe(false);
    });

    it("should reject path traversal attempts", () => {
      expect(isValidSlug("../etc/passwd")).toBe(false);
      expect(isValidSlug("test/../admin")).toBe(false);
      expect(isValidSlug("test//admin")).toBe(false);
    });

    it("should reject URL patterns", () => {
      expect(isValidSlug("http://evil.com")).toBe(false);
      expect(isValidSlug("file://test")).toBe(false);
      expect(isValidSlug("test://protocol")).toBe(false);
    });

    it("should reject percent encoding", () => {
      expect(isValidSlug("test%20space")).toBe(false);
      expect(isValidSlug("%2E%2E")).toBe(false);
    });

    it("should reject slugs not starting with alphanumeric", () => {
      expect(isValidSlug(".test")).toBe(false);
      expect(isValidSlug("-test")).toBe(false);
      expect(isValidSlug("_test")).toBe(false);
    });

    it("should reject slugs not ending with alphanumeric", () => {
      expect(isValidSlug("test.")).toBe(false);
      expect(isValidSlug("test-")).toBe(false);
      expect(isValidSlug("test_")).toBe(false);
    });

    it("should reject single non-alphanumeric characters", () => {
      expect(isValidSlug(".")).toBe(false);
      expect(isValidSlug("-")).toBe(false);
      expect(isValidSlug("_")).toBe(false);
    });

    it("should reject special characters", () => {
      expect(isValidSlug("test@org")).toBe(false);
      expect(isValidSlug("test#tag")).toBe(false);
      expect(isValidSlug("test$money")).toBe(false);
      expect(isValidSlug("test space")).toBe(false);
    });
  });
});
