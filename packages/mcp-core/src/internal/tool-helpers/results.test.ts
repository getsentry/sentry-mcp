import { describe, expect, it } from "vitest";
import { structuredResult } from "./results";

describe("structuredResult", () => {
  it("returns structured-only output for the full answer payload", () => {
    expect(structuredResult({ ok: true, count: 1 })).toEqual({
      structuredContent: { ok: true, count: 1 },
    });
  });
});
