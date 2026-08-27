import { describe, expect, it } from "vitest";
import { markdownResult, structuredResult } from "./results";

describe("structuredResult", () => {
  it("returns structured-only output for the server compatibility path", () => {
    expect(structuredResult({ ok: true, count: 1 })).toEqual({
      structuredContent: { ok: true, count: 1 },
    });
  });
});

describe("markdownResult", () => {
  it("packs markdown into both content and structuredContent", () => {
    expect(markdownResult({ markdown: "# Issue\n\nhello" })).toEqual({
      content: [{ type: "text", text: "# Issue\n\nhello" }],
      structuredContent: { markdown: "# Issue\n\nhello" },
    });
  });

  it("keeps optional extras beside markdown in structuredContent", () => {
    expect(
      markdownResult({
        markdown: "# Issue\n\nhello",
        suggestedActions: [
          {
            type: "tool_call",
            toolName: "get_agent_conversation_details",
            arguments: { conversationId: "conv-1" },
            reason: "Fetch transcript",
          },
        ],
      }),
    ).toEqual({
      content: [{ type: "text", text: "# Issue\n\nhello" }],
      structuredContent: {
        markdown: "# Issue\n\nhello",
        suggestedActions: [
          {
            type: "tool_call",
            toolName: "get_agent_conversation_details",
            arguments: { conversationId: "conv-1" },
            reason: "Fetch transcript",
          },
        ],
      },
    });
  });
});
