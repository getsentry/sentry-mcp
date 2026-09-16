import { describe, expect, it } from "vitest";
import { expandScopes, hasRequiredScopes, parseScopes } from "./permissions";

describe("alert scopes", () => {
  it("accepts alert write access and includes alert read access", () => {
    const { valid, invalid } = parseScopes("alerts:write");

    expect(invalid).toEqual([]);
    expect(expandScopes(valid)).toEqual(
      new Set(["alerts:read", "alerts:write"]),
    );
    expect(hasRequiredScopes(valid, ["alerts:read", "alerts:write"])).toBe(
      true,
    );
  });

  it("does not grant alert write access from read-only or project scopes", () => {
    const { valid, invalid } = parseScopes("alerts:read,project:write");

    expect(invalid).toEqual([]);
    expect(hasRequiredScopes(valid, ["alerts:read"])).toBe(true);
    expect(hasRequiredScopes(valid, ["alerts:write"])).toBe(false);
  });
});
