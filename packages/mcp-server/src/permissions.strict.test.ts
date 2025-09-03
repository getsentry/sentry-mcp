import { describe, expect, it } from "vitest";
import {
  validateScopesStrictFromString,
  expandScopes,
  type Scope,
} from "./permissions";

describe("validateScopesStrictFromString", () => {
  it("returns invalid tokens for unknown scopes", () => {
    const { valid, invalid } =
      validateScopesStrictFromString("foo,bar,org:admin");
    expect(invalid).toEqual(["foo", "bar"]);
    expect([...valid]).toContain("org:admin");
  });

  it("returns only valid set when all are valid", () => {
    const { valid, invalid } = validateScopesStrictFromString(
      "event:admin,org:read",
    );
    expect(invalid).toEqual([]);
    const out = new Set<Scope>(valid);
    expect(out.has("event:admin")).toBe(true);
    expect(out.has("org:read")).toBe(true);
  });
});

describe("expandScopes", () => {
  it("includes implied lower scopes", () => {
    const expanded = expandScopes(new Set<Scope>(["event:write"]));
    expect(expanded.has("event:read")).toBe(true);
    expect(expanded.has("event:write")).toBe(true);
  });
});
