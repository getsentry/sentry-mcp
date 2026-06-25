import type { StructuredToolOutput } from "../../tools/types";

/**
 * Returns a structured MCP result with a JSON text fallback for clients that do
 * not read structuredContent yet.
 */
export function structuredResult<T extends Record<string, unknown>>(
  structuredContent: T,
): StructuredToolOutput<T> {
  return {
    structuredContent,
  };
}
