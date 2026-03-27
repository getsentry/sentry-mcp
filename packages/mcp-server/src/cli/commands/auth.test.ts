import { describe, it, expect } from "vitest";
import { parseFlag } from "./auth";

describe("parseFlag", () => {
  it("parses --flag=value form", () => {
    expect(parseFlag(["--host=sentry.example.com"], "host")).toBe(
      "sentry.example.com",
    );
  });

  it("parses --flag value form", () => {
    expect(parseFlag(["--host", "sentry.example.com"], "host")).toBe(
      "sentry.example.com",
    );
  });

  it("returns undefined when flag is absent", () => {
    expect(parseFlag(["--other=foo"], "host")).toBeUndefined();
  });

  it("returns undefined when --flag is last arg with no value", () => {
    expect(parseFlag(["--host"], "host")).toBeUndefined();
  });

  it("prefers first occurrence", () => {
    expect(parseFlag(["--host=first", "--host=second"], "host")).toBe("first");
  });

  it("works with --url flag", () => {
    expect(parseFlag(["--url", "https://sentry.example.com"], "url")).toBe(
      "https://sentry.example.com",
    );
  });

  it("does not match partial flag names", () => {
    expect(parseFlag(["--hostname=foo"], "host")).toBeUndefined();
  });
});
