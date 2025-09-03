import type { z } from "zod";
import type { ServerContext } from "../types";
import type { Scope } from "../permissions";
import type {
  TextContent,
  ImageContent,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";

export interface ToolConfig<
  TSchema extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> {
  name: string;
  description: string;
  inputSchema: TSchema;
  requiredScopes?: Scope[];
  handler: (
    params: z.infer<z.ZodObject<TSchema>>,
    context: ServerContext,
  ) => Promise<string | (TextContent | ImageContent | EmbeddedResource)[]>;
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
