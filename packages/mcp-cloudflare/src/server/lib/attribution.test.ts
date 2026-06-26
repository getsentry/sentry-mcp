import { describe, expect, it } from "vitest";
import {
  UTM_SOURCE_ATTRIBUTE,
  resolveUtmSource,
  resolveUtmSourceFromUrl,
} from "./attribution";

describe("UTM_SOURCE_ATTRIBUTE", () => {
  it("is app.utm_source", () => {
    expect(UTM_SOURCE_ATTRIBUTE).toBe("app.utm_source");
  });
});

describe("resolveUtmSource", () => {
  it.each([
    // Known server-side values
    ["plugin", "plugin"],
    // Any other non-empty value buckets to "other"
    ["unknown-source", "other"],
    // Client-side values are intentionally not known server-side
    ["sentry-mcp-settings-docs-btn", "other"],
    // Absent / empty → null (do not set the attribute)
    ["", null],
    [null, null],
    [undefined, null],
  ])("maps %s → %s", (input, expected) => {
    expect(resolveUtmSource(input)).toBe(expected);
  });
});

describe("resolveUtmSourceFromUrl", () => {
  it("reads utm_source from URL search params", () => {
    const url = new URL("https://mcp.sentry.dev/mcp?utm_source=plugin");
    expect(resolveUtmSourceFromUrl(url)).toBe("plugin");
  });

  it("returns null when utm_source is absent", () => {
    const url = new URL("https://mcp.sentry.dev/mcp");
    expect(resolveUtmSourceFromUrl(url)).toBeNull();
  });

  it("buckets unknown values to other", () => {
    const url = new URL("https://mcp.sentry.dev/mcp?utm_source=something-new");
    expect(resolveUtmSourceFromUrl(url)).toBe("other");
  });
});
