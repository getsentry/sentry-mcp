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
