import type { z } from "zod";
import type { ServerContext } from "../types";

export interface ToolConfig<
  TSchema extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> {
  name: string;
  description: string;
  inputSchema: TSchema;
  handler: (
    params: z.infer<z.ZodObject<TSchema>>,
    context: ServerContext,
  ) => Promise<unknown>;
}

/**
 * Response from the search API endpoint
 */
export interface SearchResponse {
  query: string;
  results: Array<{
    id: string;
    url: string;
    snippet: string;
    relevance: number;
  }>;
  error?: string;
}
