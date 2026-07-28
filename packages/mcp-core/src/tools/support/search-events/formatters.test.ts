import { describe, expect, it } from "vitest";
import type { SentryApiService } from "../../../api-client";

import {
  formatErrorResults,
  formatExecutedSearch,
  formatLogResults,
  formatProfileResults,
  formatSpanResults,
  formatTraceMetricsResults,
} from "./formatters.js";

describe("formatExecutedSearch", () => {
  it("pads inline code values that start or end with backticks", () => {
    const result = formatExecutedSearch({
      dataset: "spans",
      query: "`release`",
      fields: ["tags[`weird`]", "`count()`", "count()`"],
      sort: "-count()",
    });

    expect(result).toContain("- Query: `` `release` ``");
    expect(result).toContain(
      "- Fields: ``tags[`weird`]``, `` `count()` ``, `` count()` ``",
    );
    expect(result).toContain("- Sort: `-count()`");
  });
});

describe("aggregate chart data", () => {
  const formatters = [
    formatErrorResults,
    formatLogResults,
    formatSpanResults,
    formatProfileResults,
    formatTraceMetricsResults,
  ];

  it.each(formatters)("adds chart data for %p", (formatter) => {
    const result = formatter({
      eventData: [{ release: '<img src=x onerror="alert(1)">', "count()": 3 }],
      inputQuery: "events by release",
      apiService: {} as SentryApiService,
      organizationSlug: "test-org",
      explorerUrl: "https://test-org.sentry.io/explore/",
      sentryQuery: "",
      fields: ["release", "count()"],
    });

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) {
      throw new Error("Expected aggregate formatter to return chart data");
    }

    expect(result[0]).toMatchObject({ type: "text" });
    expect(result[1]).toMatchObject({
      type: "resource",
      resource: {
        mimeType: "application/json;chart",
      },
    });
    const chartResource = result[1];
    if (
      chartResource.type !== "resource" ||
      !("text" in chartResource.resource)
    ) {
      throw new Error("Expected chart data as a text resource");
    }
    expect(JSON.parse(chartResource.resource.text)).toEqual({
      chartType: "pie",
      data: [{ release: '<img src=x onerror="alert(1)">', "count()": 3 }],
      labels: ["release"],
      values: ["count()"],
      query: "events by release",
    });
  });
});
