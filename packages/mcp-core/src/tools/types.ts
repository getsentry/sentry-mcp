import type {
  CallToolResult,
  EmbeddedResource,
  ImageContent,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { Scope } from "../permissions";
import type { Skill } from "../skills";
import type { ProjectCapabilities, ServerContext } from "../types";

export type ToolContent = TextContent | ImageContent | EmbeddedResource;
export interface StructuredToolOutput<
  TStructuredContent extends Record<string, unknown> = Record<string, unknown>,
> {
  structuredContent: TStructuredContent;
}
export type ToolOutput =
  | string
  | ToolContent[]
  | CallToolResult
  | StructuredToolOutput;
/**
 * Keeps schema-inferred handler params at tool definition sites while allowing
 * heterogeneous tool registries to store many concrete handler signatures.
 */
export type ToolHandler<
  TSchema extends Record<string, z.ZodType>,
  TOutput extends ToolOutput = ToolOutput,
> = {
  handler(
    params: z.infer<z.ZodObject<TSchema>>,
    context: ServerContext,
  ): Promise<TOutput>;
}["handler"];

/**
 * Context passed to dynamic description functions.
 * Allows tool descriptions to vary based on server mode.
 */
export interface DescriptionContext {
  experimentalMode: boolean;
  availableToolNames?: ReadonlySet<string>;
  directToolNames?: ReadonlySet<string>;
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
 * Determines if a tool is enabled for the current release mode.
 */
export function isToolVisibleInMode(
  tool: {
    experimental?: boolean;
    hideInExperimentalMode?: boolean;
  },
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
  includeInSkillDefinitions?: boolean; // Whether generated skill prompts advertise this tool
  requiredScopes: Scope[]; // LEGACY: Which API scopes needed (deprecated, for backward compatibility)
  experimental?: boolean; // Mark tool as experimental (only shown in experimental mode)
  hideInExperimentalMode?: boolean; // Hide tool when experimental mode is active (for tools replaced by unified tools)
  requiredCapabilities?: (keyof ProjectCapabilities)[]; // Project capabilities required for this tool
  /**
   * Narrows the advertised input schema for a specific session.
   *
   * `requiredCapabilities` gates a tool as a whole. This is for tools that
   * remain available but whose options do not all apply — `search_events`
   * serves six datasets, and only the replay dataset needs the `replays`
   * capability. Narrowing the advertised options keeps a routing agent from
   * choosing one that would be rejected at handler time.
   *
   * Called after constraint-injected parameters are removed. Returning the
   * schema unchanged is always valid.
   */
  refineInputSchema?: (
    schema: Record<string, z.ZodType>,
    context: ServerContext,
  ) => Record<string, z.ZodType>;
  outputSchema?: z.ZodType;
  annotations: {
    // readOnlyHint, destructiveHint, and openWorldHint are required so every
    // tool declares its safety posture explicitly. Filters and confirmation
    // gates rely on these; an undefined hint is a silent gap. Enforced further
    // by tools.test.ts (see "complete MCP safety annotations").
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
  handler: ToolHandler<TSchema>;
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
