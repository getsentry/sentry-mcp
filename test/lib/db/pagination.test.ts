/**
 * Unit tests for pagination context key builders.
 */

import { describe, expect, test } from "vitest";
import {
  buildOrgContextKey,
  buildPaginationContextKey,
} from "../../../src/lib/db/pagination.js";

describe("buildPaginationContextKey", () => {
  test("builds simple org-scoped key", () => {
    const key = buildPaginationContextKey("org", "my-org");
    expect(key).toContain("type:org:my-org");
    expect(key).toMatch(/^host:.+\|type:org:my-org$/);
  });

  test("includes optional params when defined", () => {
    const key = buildPaginationContextKey("trace", "my-org/my-proj", {
      sort: "date",
      q: "GET /api",
    });
    expect(key).toContain("type:trace:my-org/my-proj");
    expect(key).toContain("|sort:date");
    expect(key).toContain("|q:GET /api");
  });

  test("omits undefined params", () => {
    const key = buildPaginationContextKey("trace", "my-org/my-proj", {
      sort: "date",
      q: undefined,
    });
    expect(key).toContain("|sort:date");
    expect(key).not.toContain("|q:");
  });

  test("escapes pipe characters in param values", () => {
    const key = buildPaginationContextKey("org", "my-org", {
      q: "a|b",
    });
    expect(key).toContain("|q:a%7Cb");
    expect(key).not.toContain("|q:a|b");
  });
});

describe("buildOrgContextKey", () => {
  test("delegates to buildPaginationContextKey", () => {
    const orgKey = buildOrgContextKey("test-org");
    const directKey = buildPaginationContextKey("org", "test-org");
    expect(orgKey).toBe(directKey);
  });
});
