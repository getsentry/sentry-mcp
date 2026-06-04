import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolContent = CallToolResult["content"][number];

export interface StructuredToolResult {
  content: ToolContent[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

export type ToolHandlerResult = string | ToolContent[] | StructuredToolResult;

export interface McpToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function normalizeToolHandlerResult(
  output: ToolHandlerResult,
): McpToolResult {
  if (typeof output === "string") {
    return {
      content: [
        {
          type: "text" as const,
          text: output,
        },
      ],
    };
  }

  if (Array.isArray(output)) {
    return {
      content: output,
    };
  }

  if (isStructuredToolResult(output)) {
    return {
      content: output.content,
      structuredContent: output.structuredContent,
      ...(output.isError !== undefined ? { isError: output.isError } : {}),
    };
  }

  throw new Error(`Invalid tool output: ${output}`);
}

export function createStructuredToolResult(
  structuredContent: Record<string, unknown>,
): StructuredToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
  };
}

export function isStructuredToolResult(
  value: unknown,
): value is StructuredToolResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const result = value as {
    content?: unknown;
    structuredContent?: unknown;
  };

  return (
    Array.isArray(result.content) &&
    typeof result.structuredContent === "object" &&
    result.structuredContent !== null &&
    !Array.isArray(result.structuredContent)
  );
}
