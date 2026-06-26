import { describe, expect, it } from "vitest";
import { isStdioAuthSubcommand } from "./auth.js";

describe("isStdioAuthSubcommand", () => {
  it("accepts supported stdio auth commands", () => {
    expect(isStdioAuthSubcommand("login")).toBe(true);
    expect(isStdioAuthSubcommand("status")).toBe(true);
    expect(isStdioAuthSubcommand("logout")).toBe(true);
  });

  it("rejects unsupported values", () => {
    expect(isStdioAuthSubcommand(undefined)).toBe(false);
    expect(isStdioAuthSubcommand("whoami")).toBe(false);
  });
});
