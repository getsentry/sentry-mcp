import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { StructuredToolOutput } from "../../tools/types";

/**
 * Marks a tool result as structured-only. The server generates compatibility
 * text for clients that do not read structuredContent yet.
 */
export function structuredResult<T extends Record<string, unknown>>(
  structuredContent: T,
): StructuredToolOutput<T> {
  return {
    structuredContent,
  };
}

/**
 * Returns handwritten markdown in content and the same answer in
 * structuredContent.markdown. Optional extras (for example suggestedActions)
 * are stored beside markdown, never instead of it.
 */
export function markdownResult(
  result: {
    markdown: string;
  } & Record<string, unknown>,
): CallToolResult {
  const { markdown, ...extras } = result;
  return {
    content: [{ type: "text", text: markdown }],
    structuredContent: {
      markdown,
      ...extras,
    },
  };
}
