/**
 * Slug validation utilities to prevent path traversal and injection attacks.
 *
 * Provides reusable validation functions for use with Zod's superRefine()
 * to add security validation for URL parameters.
 */

import { z } from "zod";

/**
 * Maximum reasonable length for a slug.
 */
const MAX_SLUG_LENGTH = 100;

/**
 * Maximum reasonable length for a numeric ID.
 */
const MAX_ID_LENGTH = 20;

/**
 * Helper to check if a string is a numeric ID.
 */
export function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Valid slug pattern: alphanumeric, hyphens, underscores, and dots.
 * Must start with alphanumeric character.
 */
const VALID_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Path traversal patterns that could be used in attacks.
 * Includes various encoded forms to catch bypass attempts.
 */
const PATH_TRAVERSAL_PATTERNS = [
  "..",
  "./",
  "/..",
  "../",
  "\\",
  "%2e%2e",
  "%252e%252e",
  "..%2f",
  "%2e%2e%2f",
  "..%252f",
  "%252e%252e%252f",
  "..\\",
  "..%5c",
  "%2e%2e%5c",
  "%252e%252e%5c",
  "..%255c",
  "%252e%252e%255c",
];

/**
 * Characters that are dangerous in URL contexts.
 */
const DANGEROUS_CHARS = [
  "/",
  "\\",
  "?",
  "#",
  "&",
  "=",
  ";",
  ":",
  "@",
  "$",
  ",",
  "<",
  ">",
  '"',
  "'",
  "`",
  "{",
  "}",
  "[",
  "]",
  "|",
  "^",
  "~",
  "\0",
  "\t",
  "\n",
  "\r",
];

/**
 * Validates a slug to prevent path traversal and injection attacks.
 * Designed to be used with Zod's superRefine() method.
 *
 * @example
 * ```typescript
 * const OrganizationSlug = z.string()
 *   .toLowerCase()
 *   .trim()
 *   .superRefine(validateSlug)
 *   .describe("Organization slug");
 *
 * const TeamSlug = z.string()
 *   .toLowerCase()
 *   .trim()
 *   .superRefine(validateSlug)
 *   .describe("Team slug");
 * ```
 */
export function validateSlug(val: string, ctx: z.RefinementCtx): void {
  // Check for empty string
  if (val.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Slug cannot be empty",
    });
    return;
  }

  // Check length
  if (val.length > MAX_SLUG_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Slug exceeds maximum length of ${MAX_SLUG_LENGTH} characters`,
    });
    return;
  }

  // Check for path traversal patterns (case-insensitive)
  const lowerVal = val.toLowerCase();
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (lowerVal.includes(pattern)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Slug contains path traversal sequence",
      });
      return;
    }
  }

  // Check for URL encoding (could hide malicious patterns)
  if (val.includes("%")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Slug contains URL-encoded characters which are not allowed",
    });
    return;
  }

  // Check for dangerous characters
  for (const char of DANGEROUS_CHARS) {
    if (val.includes(char)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Slug contains invalid character '${char}'`,
      });
      return;
    }
  }

  // Validate pattern
  if (!VALID_SLUG_PATTERN.test(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Slug must contain only alphanumeric characters, hyphens, underscores, and dots, and must start with an alphanumeric character",
    });
  }
}

/**
 * Validates a parameter that can be either a slug or numeric ID.
 * Designed to be used with Zod's superRefine() method.
 *
 * @example
 * ```typescript
 * const ProjectSlugOrId = z.string()
 *   .toLowerCase()
 *   .trim()
 *   .superRefine(validateSlugOrId)
 *   .describe("Project slug or numeric ID");
 *
 * const IssueSlugOrId = z.string()
 *   .trim()
 *   .superRefine(validateSlugOrId)
 *   .describe("Issue slug or numeric ID");
 * ```
 */
export function validateSlugOrId(val: string, ctx: z.RefinementCtx): void {
  // Check if it's a numeric ID
  if (isNumericId(val)) {
    if (val.length > MAX_ID_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Numeric ID exceeds maximum length of ${MAX_ID_LENGTH} characters`,
      });
    }
    // Numeric IDs don't need slug validation
    return;
  }

  // Otherwise validate as a slug
  validateSlug(val, ctx);
}
