/**
 * Helper to prepare tools for the embedded agent without MCP overhead.
 *
 * This function uses the shared tool preparation logic from buildServer
 * but directly returns agent-compatible tools instead of creating an MCP server.
 */

import { z } from "zod";
import { agentTool } from "../../internal/agents/tools/utils";
import type { ServerContext } from "../../types";
import type { ToolConfig } from "../types";
import {
  prepareToolsForContext,
  applyConstraints,
} from "../../internal/tool-preparation";

/**
 * Prepares tools for direct use by the embedded agent.
 *
 * This function:
 * 1. Filters tools by granted scopes (same as buildServer)
 * 2. Filters out constraint parameters from schemas (same as buildServer)
 * 3. Wraps each tool with agentTool for error handling
 * 4. Pre-binds ServerContext and injects constraints (same as buildServer)
 * 5. Returns Vercel AI SDK compatible tools
 *
 * Uses shared helpers from internal/tool-preparation to ensure identical
 * behavior with buildServer for security and consistency.
 *
 * @param tools - Record of all available tools
 * @param context - Server context with constraints and scopes
 * @returns Record of agent-ready tools filtered by scope and constraints
 *
 * @example
 * ```typescript
 * const agentTools = prepareToolsForAgent(tools, context);
 * // agentTools contains only allowed tools with filtered schemas
 * await useSentryAgent({ request, tools: agentTools });
 * ```
 */
export function prepareToolsForAgent(
  tools: Record<string, ToolConfig<any>>,
  context: ServerContext,
) {
  // Use shared preparation logic (same as buildServer)
  const preparedTools = prepareToolsForContext(tools, context);

  const agentTools: Record<string, any> = {};

  for (const { key: toolKey, tool, filteredInputSchema } of preparedTools) {
    // Wrap with agentTool for error handling
    agentTools[toolKey] = agentTool({
      description: tool.description,
      // z.ZodRawShape is an alias for Record<string, ZodTypeAny>, so this cast is safe
      parameters: z.object(filteredInputSchema as z.ZodRawShape),
      execute: async (params: unknown) => {
        // Type safety: agentTool validates params against filteredInputSchema via Zod
        // before calling execute, so params is guaranteed to match the filtered schema
        const paramsWithConstraints = applyConstraints(
          params as Record<string, unknown>,
          context.constraints,
          tool.inputSchema,
        );

        // No cast needed: applyConstraints preserves types via generics
        // Runtime safety: Zod validation + constraint injection guarantees correct structure
        return await tool.handler(paramsWithConstraints, context);
      },
    });
  }

  return agentTools;
}
