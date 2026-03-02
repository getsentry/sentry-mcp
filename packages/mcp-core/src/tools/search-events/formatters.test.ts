import { describe, it, expect } from "vitest";
import {
  formatErrorResults,
  formatLogResults,
  formatSpanResults,
} from "./formatters";
import type { FormatEventResultsParams } from "./formatters";
import { SentryApiService } from "../../api-client/client";

function makeParams(
  overrides: Partial<FormatEventResultsParams> = {},
): FormatEventResultsParams {
  return {
    eventData: [{ title: "Test Error", project: "test" }],
    naturalLanguageQuery: "test query",
    apiService: new SentryApiService({ host: "sentry.io" }),
    organizationSlug: "test-org",
    explorerUrl: "https://test-org.sentry.io/explore/traces/",
    sentryQuery: "level:error",
    fields: ["title", "project"],
    ...overrides,
  };
}

describe("formatErrorResults pagination", () => {
  it("includes pagination section when nextCursor is present", () => {
    const result = formatErrorResults(
      makeParams({ nextCursor: "1735689600:0:0" }),
    );
    expect(result).toContain("More results available");
    expect(result).toContain('cursor: "1735689600:0:0"');
  });

  it("does not include pagination section when nextCursor is null", () => {
    const result = formatErrorResults(makeParams({ nextCursor: null }));
    expect(result).not.toContain("More results available");
  });

  it("does not include pagination section when nextCursor is undefined", () => {
    const result = formatErrorResults(makeParams());
    expect(result).not.toContain("More results available");
  });
});

describe("formatLogResults pagination", () => {
  it("includes pagination section when nextCursor is present", () => {
    const params = makeParams({
      nextCursor: "1735689600:0:0",
      eventData: [
        { message: "Test log", severity: "error", timestamp: "2025-01-01" },
      ],
      fields: ["message", "severity", "timestamp"],
    });
    const result = formatLogResults(params);
    expect(result).toContain("More results available");
    expect(result).toContain('cursor: "1735689600:0:0"');
  });

  it("does not include pagination section when nextCursor is null", () => {
    const params = makeParams({
      nextCursor: null,
      eventData: [
        { message: "Test log", severity: "error", timestamp: "2025-01-01" },
      ],
      fields: ["message", "severity", "timestamp"],
    });
    const result = formatLogResults(params);
    expect(result).not.toContain("More results available");
  });
});

describe("formatSpanResults pagination", () => {
  it("includes pagination section when nextCursor is present", () => {
    const params = makeParams({
      nextCursor: "1735689600:0:0",
      eventData: [
        {
          "span.op": "http.client",
          "span.description": "GET /api",
          "span.duration": 120,
        },
      ],
      fields: ["span.op", "span.description", "span.duration"],
    });
    const result = formatSpanResults(params);
    expect(result).toContain("More results available");
    expect(result).toContain('cursor: "1735689600:0:0"');
  });

  it("does not include pagination section when nextCursor is null", () => {
    const params = makeParams({
      nextCursor: null,
      eventData: [
        {
          "span.op": "http.client",
          "span.description": "GET /api",
          "span.duration": 120,
        },
      ],
      fields: ["span.op", "span.description", "span.duration"],
    });
    const result = formatSpanResults(params);
    expect(result).not.toContain("More results available");
  });
});
