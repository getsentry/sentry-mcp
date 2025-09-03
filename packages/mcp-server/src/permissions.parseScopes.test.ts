import { describe, it, expect } from "vitest";
import { parseScopes, expandScopes, type Scope } from "./permissions";

describe("parseScopes", () => {
  it("parses comma-separated string with trimming and de-dup", () => {
    const { valid, invalid } = parseScopes(
      "event:write, foo, org:admin, , event:write",
    );
    const v = new Set<Scope>(valid);
    expect(v.has("event:write")).toBe(true);
    expect(v.has("org:admin")).toBe(true);
    expect(invalid).toEqual(["foo"]);
  });

  it("parses arrays and filters non-strings", () => {
    const { valid, invalid } = parseScopes([
      "member:read",
      "x",
      123 as unknown,
      " team:write ",
      "",
    ]);
    const v = new Set<Scope>(valid);
    expect(v.has("member:read")).toBe(true);
    expect(v.has("team:write")).toBe(true);
    expect(invalid).toEqual(["x"]);
  });

  it("handles empty or undefined inputs", () => {
    expect(parseScopes("")).toEqual({ valid: new Set<Scope>(), invalid: [] });
    expect(parseScopes(undefined)).toEqual({
      valid: new Set<Scope>(),
      invalid: [],
    });
    expect(parseScopes([])).toEqual({ valid: new Set<Scope>(), invalid: [] });
  });
});

// Consolidated strict-like parseScopes cases
describe("parseScopes (strict-like cases)", () => {
  it("returns invalid tokens for unknown scopes", () => {
    const { valid, invalid } = parseScopes("foo,bar,org:admin");
    expect(invalid).toEqual(["foo", "bar"]);
    expect([...valid]).toContain("org:admin");
  });

  it("returns only valid set when all are valid", () => {
    const { valid, invalid } = parseScopes("event:admin,org:read");
    expect(invalid).toEqual([]);
    const out = new Set<Scope>(valid);
    expect(out.has("event:admin")).toBe(true);
    expect(out.has("org:read")).toBe(true);
  });
});

// Related behavior validation for expandScopes
describe("expandScopes", () => {
  it("includes implied lower scopes", () => {
    const expanded = expandScopes(new Set<Scope>(["event:write"]));
    expect(expanded.has("event:read")).toBe(true);
    expect(expanded.has("event:write")).toBe(true);
  });
});
