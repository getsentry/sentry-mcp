import { describe, it, expect } from "vitest";
import { SentryApiService } from "./client.js";

describe("getIssueUrl", () => {
  it("should work with sentry.io", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });
    const result = apiService.getIssueUrl("sentry-mcp", "123456");
    expect(result).toMatchInlineSnapshot(
      `"https://sentry-mcp.sentry.io/issues/123456"`,
    );
  });
  it("should work with self-hosted", () => {
    const apiService = new SentryApiService({ host: "sentry.example.com" });
    const result = apiService.getIssueUrl("sentry-mcp", "123456");
    expect(result).toMatchInlineSnapshot(
      `"https://sentry.example.com/organizations/sentry-mcp/issues/123456"`,
    );
  });
});

describe("getTraceUrl", () => {
  it("should work with sentry.io", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });
    const result = apiService.getTraceUrl(
      "sentry-mcp",
      "6a477f5b0f31ef7b6b9b5e1dea66c91d",
    );
    expect(result).toMatchInlineSnapshot(
      `"https://sentry-mcp.sentry.io/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d"`,
    );
  });
  it("should work with self-hosted", () => {
    const apiService = new SentryApiService({ host: "sentry.example.com" });
    const result = apiService.getTraceUrl(
      "sentry-mcp",
      "6a477f5b0f31ef7b6b9b5e1dea66c91d",
    );
    expect(result).toMatchInlineSnapshot(
      `"https://sentry.example.com/organizations/sentry-mcp/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d"`,
    );
  });
});
