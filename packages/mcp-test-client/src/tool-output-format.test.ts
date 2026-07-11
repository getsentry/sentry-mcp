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

  it("uses structured content when the content container is malformed", () => {
    expect(
      formatToolOutputForDisplay({
        content: "invalid",
        structuredContent: { status: "ok" },
      }),
    ).toBe('{"status":"ok"}');
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

  it("preserves valid content when a sibling item is malformed", () => {
    expect(
      formatToolOutputForDisplay({
        content: [
          { type: "text", text: "valid text" },
          null,
          { type: "text", text: 42 },
        ],
      }),
    ).toBe("valid text<unknown message><text message>");
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
