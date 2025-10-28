/**
 * Generic tool wrapper for the use_sentry embedded agent.
 *
 * Provides a single function that can wrap ANY MCP tool handler
 * to work with the embedded agent pattern.
 */

import { z } from "zod";
import { agentTool } from "../../internal/agents/tools/utils";
import type { ServerContext } from "../../types";
import type { ToolConfig } from "../types";

/**
 * Options for wrapping a tool
 */
export interface WrapToolOptions {
  context: ServerContext;
}

/**
 * Helper to inject constrained parameters into tool calls.
 * This applies session-level constraints (org, project, region) to tool parameters.
 */
function injectConstrainedParams(
  params: Record<string, any>,
  constraints: ServerContext["constraints"],
): Record<string, any> {
  const result = { ...params };

  // Apply organization constraint if set
  if (constraints.organizationSlug && !result.organizationSlug) {
    result.organizationSlug = constraints.organizationSlug;
  }

  // Apply project constraint (handle both projectSlug and projectSlugOrId)
  if (constraints.projectSlug) {
    if (!result.projectSlug) {
      result.projectSlug = constraints.projectSlug;
    }
    if (!result.projectSlugOrId) {
      result.projectSlugOrId = constraints.projectSlug;
    }
  }

  // Apply region constraint if set
  if (constraints.regionUrl && !result.regionUrl) {
    result.regionUrl = constraints.regionUrl;
  }

  return result;
}

/**
 * Wraps any MCP tool to work with the embedded agent pattern.
 *
 * This function:
 * 1. Takes a tool definition with its handler
 * 2. Creates an agentTool-wrapped version
 * 3. Pre-binds ServerContext so the agent doesn't need it
 * 4. Applies session constraints automatically
 * 5. Handles errors via agentTool's error handling
 *
 * @param tool - The MCP tool to wrap (from defineTool)
 * @param options - Context and configuration for the tool
 * @returns An agentTool-wrapped version ready for use by the embedded agent
 *
 * @example
 * ```typescript
 * const whoami = wrapToolForAgent(whoamiTool, { context });
 * const findOrgs = wrapToolForAgent(findOrganizationsTool, { context });
 * ```
 */
export function wrapToolForAgent<TSchema extends Record<string, z.ZodType>>(
  tool: ToolConfig<TSchema>,
  options: WrapToolOptions,
) {
  return agentTool({
    description: tool.description,
    parameters: z.object(tool.inputSchema),
    execute: async (params: any) => {
      // Inject constrained parameters from ServerContext
      const fullParams = injectConstrainedParams(
        params as Record<string, any>,
        options.context.constraints,
      );

      // Call the actual tool handler with full context
      // Cast to any to handle the dynamic parameter types
      const result = await tool.handler(fullParams as any, options.context);

      // Return the result - agentTool handles error wrapping
      return result;
    },
  });
}
