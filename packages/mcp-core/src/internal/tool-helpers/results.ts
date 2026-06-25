import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type StructuredTextResult<
  TStructuredContent extends Record<string, unknown>,
> = CallToolResult & {
  structuredContent: TStructuredContent;
};

export function createStructuredTextResult<
  TStructuredContent extends Record<string, unknown>,
>({
  text,
  structuredContent,
}: {
  text: string;
  structuredContent: TStructuredContent;
}): StructuredTextResult<TStructuredContent> {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    structuredContent,
  };
}
