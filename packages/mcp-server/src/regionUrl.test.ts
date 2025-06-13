import { describe, it, expect } from "vitest";
import { ParamRegionUrl } from "./schema";

describe("ParamRegionUrl self-hosted compatibility", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(() => ParamRegionUrl.parse("https://us.sentry.io")).not.toThrow();
    expect(() =>
      ParamRegionUrl.parse("https://selfhosted.example.com"),
    ).not.toThrow();
  });

  it("accepts empty strings (key fix for self-hosted)", () => {
    expect(() => ParamRegionUrl.parse("")).not.toThrow();
    expect(ParamRegionUrl.parse("")).toBe("");
  });

  it("trims whitespace correctly", () => {
    expect(ParamRegionUrl.parse("  https://us.sentry.io  ")).toBe(
      "https://us.sentry.io",
    );
    expect(ParamRegionUrl.parse("  ")).toBe("");
  });
});
