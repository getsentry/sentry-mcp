import { describe, expect, it } from "vitest";
import { formatInlineCode } from "./formatting";

describe("formatInlineCode", () => {
  it("uses a fence longer than backtick runs in the value", () => {
    expect(formatInlineCode("has:error `token`")).toBe(
      "`` has:error `token` ``",
    );
    expect(formatInlineCode("`release`")).toBe("`` `release` ``");
  });
});
