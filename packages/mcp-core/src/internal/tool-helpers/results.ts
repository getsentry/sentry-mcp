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
 * Markdown-primary result that still packs the answer into structuredContent.
 *
 * content keeps handwritten markdown for content-first clients. structuredContent
 * always includes that same markdown so structured-preferring clients do not lose
 * the primary answer when optional fields (for example suggestedActions) are present.
 */
export function markdownResult<
  TExtras extends Record<string, unknown> = Record<string, never>,
>({ markdown, ...extras }: { markdown: string } & TExtras): CallToolResult {
  return {
    content: [{ type: "text", text: markdown }],
    structuredContent: {
      markdown,
      ...extras,
    },
  };
}
