import { z } from "zod";
import type { ServerContext } from "../types";
import type {
  TextContent,
  ImageContent,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";

export const ResponseTypeSchema = z.enum(["md", "json"]).default("md");

export interface ToolConfig<
  TSchema extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> {
  name: string;
  description: string;
  inputSchema: TSchema & {
    responseType?: typeof ResponseTypeSchema;
  };
  handler: (
    params: z.infer<z.ZodObject<TSchema>> & {
      responseType?: "md" | "json";
    },
    context: ServerContext,
  ) => Promise<
    | string
    | Record<string, unknown>
    | (TextContent | ImageContent | EmbeddedResource)[]
  >;
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
