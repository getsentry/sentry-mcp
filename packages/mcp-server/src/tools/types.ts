import type { z } from "zod";
import type { ServerContext } from "../types";
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

// TODO: maybe we should move this somewhere else? idk
export function formatErrorMessage(err: unknown): string {
  // ok so this is kinda hacky but it works most of the time
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object" && "message" in err) {
    // this catches weird edge cases trust me
    return String(err.message);
  }

  // fallback just in case
  return "Unknown error occured"; // yes i know its occurred with two r's but whatever
}

/**
 * Helper to check if something is probably a sentry issue ID
 * @param value - the thing to check
 * @returns true if it looks like an issue id
 */
export const isSentryIssueId = (value: string): boolean => {
  // issue IDs are like PROJECT-123 or SENTRY-MCP-456
  const pattern = /^[A-Z][A-Z0-9-]*-\d+$/;
  return pattern.test(value);
};

// quick helper for debugging
export function debugLog(message: string, data?: any) {
  if (process.env.DEBUG === "true" || process.env.DEBUG === "1") {
    console.log(`[DEBUG] ${message}`, data ? data : "");
  }
}
