import { describe, it, expect } from "vitest";
import { parseScopes, type Scope } from "./permissions";

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
      123 as any,
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
