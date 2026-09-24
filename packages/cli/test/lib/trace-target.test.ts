/**
 * Tests for shared trace-target parsing and resolution.
 *
 * Tests parseTraceTarget, parseSlashSeparatedTraceTarget,
 * and targetArgToTraceTarget from src/lib/trace-target.ts.
 */

import { describe, expect, test } from "vitest";
import { ContextError, ValidationError } from "../../src/lib/errors.js";
import {
  parseSlashSeparatedTraceTarget,
  parseTraceTarget,
  targetArgToTraceTarget,
} from "../../src/lib/trace-target.js";

const VALID_TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";

describe("parseSlashSeparatedTraceTarget", () => {
  const HINT = "sentry span list [<org>/<project>/]<trace-id>";

  test("bare trace ID → auto-detect", () => {
    const result = parseSlashSeparatedTraceTarget(VALID_TRACE_ID, HINT);
    expect(result.type).toBe("auto-detect");
    expect(result.traceId).toBe(VALID_TRACE_ID);
  });

  test("normalizes uppercase trace ID", () => {
    const result = parseSlashSeparatedTraceTarget(
      "AAAA1111BBBB2222CCCC3333DDDD4444",
      HINT
    );
    expect(result.traceId).toBe(VALID_TRACE_ID);
  });

  test("strips UUID dashes from trace ID", () => {
    const result = parseSlashSeparatedTraceTarget(
      "aaaa1111-bbbb-2222-cccc-3333dddd4444",
      HINT
    );
    expect(result.traceId).toBe(VALID_TRACE_ID);
  });

  test("org/trace-id → org-scoped", () => {
    const result = parseSlashSeparatedTraceTarget(
      `my-org/${VALID_TRACE_ID}`,
      HINT
    );
    expect(result.type).toBe("org-scoped");
    expect(result.traceId).toBe(VALID_TRACE_ID);
    if (result.type === "org-scoped") {
      expect(result.org).toBe("my-org");
    }
  });

  test("org/project/trace-id → explicit", () => {
    const result = parseSlashSeparatedTraceTarget(
      `my-org/my-project/${VALID_TRACE_ID}`,
      HINT
    );
    expect(result.type).toBe("explicit");
    expect(result.traceId).toBe(VALID_TRACE_ID);
    if (result.type === "explicit") {
      expect(result.org).toBe("my-org");
      expect(result.project).toBe("my-project");
    }
  });

  test("preserves underscores in slugs (see #770)", () => {
    // Sentry accepts underscores in project slugs, so they must flow
    // through the trace-target parser unchanged.
    const result = parseSlashSeparatedTraceTarget(
      `my_org/my_project/${VALID_TRACE_ID}`,
      HINT
    );
    expect(result.type).toBe("explicit");
    if (result.type === "explicit") {
      expect(result.org).toBe("my_org");
      expect(result.project).toBe("my_project");
      expect(result.normalized).toBeUndefined();
    }
  });

  test("trailing slash without trace ID throws", () => {
    expect(() => parseSlashSeparatedTraceTarget("my-org/", HINT)).toThrow(
      ContextError
    );
  });

  test("invalid trace ID throws ValidationError", () => {
    expect(() =>
      parseSlashSeparatedTraceTarget("not-a-trace-id", HINT)
    ).toThrow(ValidationError);
  });
});

describe("targetArgToTraceTarget", () => {
  test("explicit target (org/project)", () => {
    const result = targetArgToTraceTarget("my-org/my-project", VALID_TRACE_ID);
    expect(result.type).toBe("explicit");
    expect(result.traceId).toBe(VALID_TRACE_ID);
  });

  test("org-all target (org/) → org-scoped", () => {
    const result = targetArgToTraceTarget("my-org/", VALID_TRACE_ID);
    expect(result.type).toBe("org-scoped");
    if (result.type === "org-scoped") {
      expect(result.org).toBe("my-org");
    }
  });

  test("bare slug → project-search", () => {
    const result = targetArgToTraceTarget("frontend", VALID_TRACE_ID);
    expect(result.type).toBe("project-search");
    if (result.type === "project-search") {
      expect(result.projectSlug).toBe("frontend");
    }
  });

  test("empty string → auto-detect", () => {
    const result = targetArgToTraceTarget("", VALID_TRACE_ID);
    expect(result.type).toBe("auto-detect");
  });
});

describe("parseTraceTarget", () => {
  const HINT = "sentry span list [<org>/<project>/]<trace-id>";

  test("empty args throws ContextError", () => {
    expect(() => parseTraceTarget([], HINT)).toThrow(ContextError);
  });

  test("single arg: bare trace ID → auto-detect", () => {
    const result = parseTraceTarget([VALID_TRACE_ID], HINT);
    expect(result.type).toBe("auto-detect");
    expect(result.traceId).toBe(VALID_TRACE_ID);
  });

  test("single arg: org/project/trace-id → explicit", () => {
    const result = parseTraceTarget(
      [`my-org/my-project/${VALID_TRACE_ID}`],
      HINT
    );
    expect(result.type).toBe("explicit");
    expect(result.traceId).toBe(VALID_TRACE_ID);
  });

  test("single arg: org/trace-id → org-scoped", () => {
    const result = parseTraceTarget([`my-org/${VALID_TRACE_ID}`], HINT);
    expect(result.type).toBe("org-scoped");
  });

  test("two args: target + trace-id", () => {
    const result = parseTraceTarget(
      ["my-org/my-project", VALID_TRACE_ID],
      HINT
    );
    expect(result.type).toBe("explicit");
    expect(result.traceId).toBe(VALID_TRACE_ID);
  });

  test("two args: bare slug + trace-id → project-search", () => {
    const result = parseTraceTarget(["frontend", VALID_TRACE_ID], HINT);
    expect(result.type).toBe("project-search");
    expect(result.traceId).toBe(VALID_TRACE_ID);
  });

  test("invalid trace ID throws ValidationError", () => {
    expect(() => parseTraceTarget(["not-valid"], HINT)).toThrow(
      ValidationError
    );
  });
});
