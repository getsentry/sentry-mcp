import { describe, expect, it } from "vitest";
import { formatToolOutputForDisplay } from "./tool-output-format.js";

describe("formatToolOutputForDisplay", () => {
  it("extracts text from raw MCP tool content arrays", () => {
    expect(
      formatToolOutputForDisplay({
        content: [
          { type: "text", text: "first line" },
          { type: "text", text: "\nsecond line" },
        ],
      }),
    ).toBe("first line\nsecond line");
  });

  it("falls back to structured content when no content is available", () => {
    expect(
      formatToolOutputForDisplay({
        structuredContent: {
          status: "ok",
          count: 2,
        },
      }),
    ).toBe('{"status":"ok","count":2}');
  });

  it("renders non-text content with placeholders", () => {
    expect(
      formatToolOutputForDisplay({
        content: [
          { type: "image", mimeType: "image/png", data: "abc" },
          { type: "resource", resource: { uri: "file:///tmp/test.txt" } },
        ],
      }),
    ).toBe("<image message><resource message>");
  });

  it("supports legacy toolResult payloads", () => {
    expect(
      formatToolOutputForDisplay({
        toolResult: {
          message: "legacy result",
        },
      }),
    ).toBe('{"message":"legacy result"}');
  });
});
