/**
 * Generic tool wrapper for the use_sentry embedded agent.
 *
 * Provides a single function that can wrap ANY MCP tool handler
 * to work with the embedded agent pattern.
 */

import { z } from "zod";
import { ApiAuthenticationError } from "../../api-client";
import { agentTool } from "../../internal/agents/tools/utils";
import type { ServerContext } from "../../types";
import { type ToolConfig, resolveDescription } from "../types";

// Walks error.cause up to 3 levels so tools that wrap upstream errors still
// surface the auth signal. Mirrors the helper in server.ts.
function isApiAuthenticationErrorDeep(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 3; i++) {
    if (current instanceof ApiAuthenticationError) return true;
    if (!(current instanceof Error)) return false;
    current = current.cause;
  }
  return false;
}

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
  // Resolve dynamic descriptions based on context
  const resolved = resolveDescription(tool.description, {
    experimentalMode: options.context.experimentalMode ?? false,
  });

  return agentTool({
    description: resolved,
    parameters: z.object(tool.inputSchema),
    execute: async (params: unknown) => {
      // Type safety: params is validated by agentTool's Zod schema before reaching here
      const fullParams = injectConstrainedParams(
        params as Record<string, unknown>,
        options.context.constraints,
      );

      try {
        // Call the actual tool handler with full context
        // Type assertion is safe: fullParams matches the tool's input schema (enforced by Zod)
        return await tool.handler(fullParams as never, options.context);
      } catch (error) {
        // The AI SDK converts thrown errors into tool-result messages for the
        // LLM, which would swallow the upstream-auth signal. Route it out via
        // the transport callback before re-throwing so the grant still gets
        // revoked even when the 401 happens inside the embedded agent.
        if (
          isApiAuthenticationErrorDeep(error) &&
          options.context.onUpstreamUnauthorized
        ) {
          try {
            await options.context.onUpstreamUnauthorized();
          } catch {}
        }
        throw error;
      }
    },
  });
}
