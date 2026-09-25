import type { z } from "zod";
import type { ToolConfig, ToolHandler, ToolOutput } from "../../tools/types";

type DefinedToolConfig<
  TSchema extends Record<string, z.ZodType>,
  TOutput extends ToolOutput,
> = Omit<ToolConfig<TSchema>, "handler"> & {
  handler: ToolHandler<TSchema, TOutput>;
};

export function defineTool<
  TSchema extends Record<string, z.ZodType>,
  TOutput extends ToolOutput,
>(
  config: DefinedToolConfig<TSchema, TOutput>,
): DefinedToolConfig<TSchema, TOutput> {
  return config;
}
