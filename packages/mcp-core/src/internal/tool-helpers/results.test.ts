import { describe, expect, it } from "vitest";
import { markdownResult, structuredResult } from "./results";

describe("structuredResult", () => {
  it("returns structured-only output", () => {
    expect(structuredResult({ ok: true })).toEqual({
      structuredContent: { ok: true },
    });
  });
});

describe("markdownResult", () => {
  it("puts the same markdown in content and structuredContent", () => {
    expect(markdownResult({ markdown: "# Issue\n\nhello" })).toEqual({
      content: [{ type: "text", text: "# Issue\n\nhello" }],
      structuredContent: { markdown: "# Issue\n\nhello" },
    });
  });

  it("keeps extras beside markdown, not instead of it", () => {
    expect(
      markdownResult({
        markdown: "# Issue\n\nhello",
        suggestedActions: [{ type: "tool_call", toolName: "x", arguments: {} }],
      }),
    ).toEqual({
      content: [{ type: "text", text: "# Issue\n\nhello" }],
      structuredContent: {
        markdown: "# Issue\n\nhello",
        suggestedActions: [{ type: "tool_call", toolName: "x", arguments: {} }],
      },
    });
  });
});
