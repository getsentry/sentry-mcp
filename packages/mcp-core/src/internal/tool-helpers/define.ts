import type { z } from "zod";
import type { ToolConfig } from "../../tools/types";

export function defineTool<TSchema extends Record<string, z.ZodType>>(
  config: ToolConfig<TSchema>,
) {
  return config;
}
