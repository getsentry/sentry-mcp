import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateSlug, validateSlugOrId, isNumericId } from "./slug-validation";

describe("slug-validation", () => {
  describe("validateSlug", () => {
    it("should accept valid slugs", () => {
      const validSlugs = [
        "my-project",
        "my_project",
        "myproject",
        "my.project",
        "project123",
        "123project",
        "a",
        "a-b-c-d-e-f",
        "test_123.abc-def",
      ];

      for (const slug of validSlugs) {
        const schema = z.string().superRefine(validateSlug);
        expect(() => schema.parse(slug)).not.toThrow();
      }
    });

    it("should reject path traversal patterns", () => {
      const dangerousSlugs = [
        "..",
        "../",
        "./..",
        "../../",
        "../../../",
        "..\\",
        "..%2f",
        "%2e%2e",
        "%252e%252e",
        "..%252f",
        "%2e%2e%2f",
        "%252e%252e%252f",
        "..%5c",
        "%2e%2e%5c",
        "%252e%252e%5c",
        "my-project/..",
        "../my-project",
        "my/../project",
        "..-auth",
        "../../..-welcome",
      ];

      for (const slug of dangerousSlugs) {
        const schema = z.string().superRefine(validateSlug);
        expect(() => schema.parse(slug)).toThrow(/alphanumeric/i);
      }
    });

    it("should reject URL-encoded characters", () => {
      const encodedSlugs = [
        "my%20project",
        "project%2Ftest",
        "%3Cscript%3E",
        "test%00null",
      ];

      for (const slug of encodedSlugs) {
        const schema = z.string().superRefine(validateSlug);
        expect(() => schema.parse(slug)).toThrow(/alphanumeric/i);
      }
    });

    it("should reject dangerous special characters", () => {
      const dangerousChars = [
        "my/project",
        "my\\project",
        "my?project",
        "my#project",
        "my&project",
        "my=project",
        "my;project",
        "my:project",
        "my@project",
        "my$project",
        "my,project",
        "my<project>",
        'my"project"',
        "my'project'",
        "my`project`",
        "my{project}",
        "my[project]",
        "my|project",
        "my^project",
        "my~project",
        "my\tproject",
        "my\nproject",
        "my\rproject",
      ];

      for (const slug of dangerousChars) {
        const schema = z.string().superRefine(validateSlug);
        // Some characters are caught as path traversal (e.g., '/'), others as invalid characters
        expect(() => schema.parse(slug)).toThrow();
      }
    });

    it("should reject slugs exceeding maximum length", () => {
      const longSlug = "a".repeat(101);
      const schema = z.string().superRefine(validateSlug);
      expect(() => schema.parse(longSlug)).toThrow(/exceeds maximum length/i);
    });

    it("should reject slugs not matching valid pattern", () => {
      const invalidPatterns = [
        "-startwithdash",
        "_startwithunderscore",
        ".startwithdot",
        "has spaces",
        "has\ttabs",
        "",
      ];

      for (const slug of invalidPatterns) {
        const schema = z.string().superRefine(validateSlug);
        expect(() => schema.parse(slug)).toThrow();
      }
    });
  });

  describe("validateSlugOrId", () => {
    it("should accept valid numeric IDs", () => {
      const validIds = [
        "1",
        "123",
        "456789",
        "12345678901234567890", // 20 chars - max length
      ];

      for (const id of validIds) {
        const schema = z.string().superRefine(validateSlugOrId);
        expect(() => schema.parse(id)).not.toThrow();
      }
    });

    it("should reject numeric IDs that are too long", () => {
      const longId = "1".repeat(21);
      const schema = z.string().superRefine(validateSlugOrId);
      expect(() => schema.parse(longId)).toThrow(/exceeds maximum length/i);
    });

    it("should accept valid slugs", () => {
      const validSlugs = [
        "my-project",
        "my_project",
        "myproject",
        "project123",
      ];

      for (const slug of validSlugs) {
        const schema = z.string().superRefine(validateSlugOrId);
        expect(() => schema.parse(slug)).not.toThrow();
      }
    });

    it("should reject path traversal in slugs but not numeric IDs", () => {
      // Should reject path traversal in slugs
      const schema = z.string().superRefine(validateSlugOrId);
      expect(() => schema.parse("../project")).toThrow(/alphanumeric/i);
      expect(() => schema.parse("..-auth")).toThrow(/alphanumeric/i);

      // Should accept numeric IDs even if they contain patterns that would be dangerous in slugs
      // (numeric IDs can't contain these patterns anyway since they're only digits)
      expect(() => schema.parse("123456")).not.toThrow();
    });
  });

  describe("integration with ParamOrganizationSlug", () => {
    it("should validate organization slugs with transformations", () => {
      // Import the actual param schema to test integration
      const ParamOrganizationSlug = z
        .string()
        .toLowerCase()
        .trim()
        .superRefine(validateSlug);

      // Should transform and validate
      expect(ParamOrganizationSlug.parse("  MY-ORG  ")).toBe("my-org");
      expect(ParamOrganizationSlug.parse("MY_ORG")).toBe("my_org");

      // Should reject dangerous patterns after transformation
      expect(() => ParamOrganizationSlug.parse("  ../MY-ORG  ")).toThrow(
        /alphanumeric/i,
      );
      expect(() => ParamOrganizationSlug.parse("..-auth")).toThrow(
        /alphanumeric/i,
      );
    });
  });

  describe("isNumericId", () => {
    it("should correctly identify numeric IDs", () => {
      expect(isNumericId("123")).toBe(true);
      expect(isNumericId("0")).toBe(true);
      expect(isNumericId("999999999999999")).toBe(true);

      expect(isNumericId("abc")).toBe(false);
      expect(isNumericId("123abc")).toBe(false);
      expect(isNumericId("")).toBe(false);
      expect(isNumericId("12.34")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should reject empty strings", () => {
      const schema = z.string().superRefine(validateSlug);
      expect(() => schema.parse("")).toThrow(/empty/i);
    });

    it("should reject null bytes", () => {
      const schema = z.string().superRefine(validateSlug);
      expect(() => schema.parse("my\0project")).toThrow(/alphanumeric/i);
      expect(() => schema.parse("\0")).toThrow(/alphanumeric/i);
    });

    it("should handle case sensitivity correctly", () => {
      const schema = z.string().toLowerCase().trim().superRefine(validateSlug);

      // Should normalize and then validate
      expect(() => schema.parse("..AUTH")).toThrow(/alphanumeric/i);
      expect(() => schema.parse("../AUTH")).toThrow(/alphanumeric/i);
      expect(() => schema.parse("%2E%2E")).toThrow(/alphanumeric/i);
    });

    it("should handle very long inputs efficiently", () => {
      const longSlug = "a".repeat(1000);
      const schema = z.string().superRefine(validateSlug);

      const start = Date.now();
      expect(() => schema.parse(longSlug)).toThrow(/exceeds maximum length/i);
      const duration = Date.now() - start;

      // Should fail quickly without processing entire string
      expect(duration).toBeLessThan(10); // milliseconds
    });
  });

  describe("real-world attack vectors", () => {
    it("should block the reported vulnerability examples", () => {
      const schema = z.string().superRefine(validateSlug);

      // From the vulnerability report
      expect(() => schema.parse("..-auth")).toThrow(/alphanumeric/i);
      expect(() => schema.parse("../../..-welcome")).toThrow(/alphanumeric/i);

      // Variations
      expect(() => schema.parse("valid/..-auth")).toThrow(/alphanumeric/i);
      expect(() => schema.parse("..-auth/valid")).toThrow(/alphanumeric/i);
    });

    it("should handle encoded variations", () => {
      const schema = z.string().superRefine(validateSlug);

      // URL encoded dots
      expect(() => schema.parse("%2e%2e-auth")).toThrow(/alphanumeric/i);
      expect(() => schema.parse("%252e%252e-auth")).toThrow(/alphanumeric/i);

      // Mixed encoding - path traversal is caught first if literal ".." exists
      expect(() => schema.parse("..%2fauth")).toThrow(/alphanumeric/i);
      expect(() => schema.parse("%2e.%2fauth")).toThrow(/alphanumeric/i);
    });
  });
});
