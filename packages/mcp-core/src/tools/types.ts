import type { z } from "zod";
import type { ServerContext, ProjectCapabilities } from "../types";
import type { Scope } from "../permissions";
import type { Skill } from "../skills";
import type {
  TextContent,
  ImageContent,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Context passed to dynamic description functions.
 * Allows tool descriptions to vary based on server mode.
 */
export interface DescriptionContext {
  experimentalMode: boolean;
}

/**
 * Tool description can be a static string or a function that returns
 * a string based on the server context (e.g., experimental mode).
 */
export type ToolDescription =
  | string
  | ((context: DescriptionContext) => string);

/**
 * Resolves a tool description to a string.
 * Handles both static strings and dynamic description functions.
 */
export function resolveDescription(
  description: ToolDescription,
  context: DescriptionContext,
): string {
  return typeof description === "function" ? description(context) : description;
}

/**
 * Determines if a tool should be visible based on experimental mode.
 * - Tools with `experimental: true` are only visible when experimentalMode is true
 * - Tools with `hideInExperimentalMode: true` are hidden when experimentalMode is true
 */
export function isToolVisibleInMode(
  tool: { experimental?: boolean; hideInExperimentalMode?: boolean },
  experimentalMode: boolean,
): boolean {
  if (tool.experimental && !experimentalMode) return false;
  if (tool.hideInExperimentalMode && experimentalMode) return false;
  return true;
}

export interface ToolConfig<
  TSchema extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> {
  name: string;
  description: ToolDescription;
  inputSchema: TSchema;
  skills: Skill[]; // Which skill categories this tool belongs to
  requiredScopes: Scope[]; // LEGACY: Which API scopes needed (deprecated, for backward compatibility)
  experimental?: boolean; // Mark tool as experimental (only shown in experimental mode)
  hideInExperimentalMode?: boolean; // Hide tool when experimental mode is active (for tools replaced by unified tools)
  requiredCapabilities?: (keyof ProjectCapabilities)[]; // Project capabilities required for this tool
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
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
