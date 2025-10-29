/**
 * Shared tool preparation logic used by both MCP server and embedded agents.
 *
 * This module extracts the common patterns for:
 * - Filtering tools by granted scopes
 * - Filtering schemas by constraints
 * - Applying constraints to tool parameters
 *
 * Both buildServer (MCP) and prepareToolsForAgent (use_sentry) use these helpers
 * to ensure consistent security and behavior.
 */

import type { z } from "zod";
import { isToolAllowed, type Scope } from "../permissions";
import { DEFAULT_SCOPES } from "../constants";
import {
  getConstraintKeysToFilter,
  getConstraintParametersToInject,
} from "./constraint-helpers";
import type { ServerContext } from "../types";
import type { ToolConfig } from "../tools/types";

/**
 * Represents a tool that has been prepared for use with a specific context.
 * Schema has been filtered to remove constrained parameters.
 */
export interface PreparedTool {
  /** Tool identifier key */
  key: string;
  /** The tool configuration */
  tool: ToolConfig<any>;
  /**
   * Input schema with constrained parameters removed.
   * This is a subset of tool.inputSchema - filtered at runtime based on context.constraints
   */
  filteredInputSchema: Record<string, z.ZodType>;
}

/**
 * Prepares tools for use with a given context.
 *
 * This function:
 * 1. Filters tools by granted scopes (removes tools user doesn't have access to)
 * 2. Filters schemas by constraints (removes parameters that will be auto-injected)
 *
 * Used by both:
 * - buildServer: To register tools with MCP server
 * - prepareToolsForAgent: To wrap tools for embedded agent
 *
 * @param tools - Record of all available tools
 * @param context - Server context with scopes and constraints
 * @returns Array of prepared tools filtered by scope with filtered schemas
 *
 * @example
 * ```typescript
 * const context = { constraints: { organizationSlug: "my-org" }, ... };
 * const prepared = prepareToolsForContext(tools, context);
 * // Returns tools where organizationSlug parameter is removed from schemas
 * ```
 */
export function prepareToolsForContext(
  tools: Record<string, ToolConfig<any>>,
  context: ServerContext,
): PreparedTool[] {
  // Returns non-generic array to avoid TypeScript depth issues
  // Get granted scopes from context for tool filtering
  const grantedScopes: Set<Scope> = context.grantedScopes
    ? new Set<Scope>(context.grantedScopes)
    : new Set<Scope>(DEFAULT_SCOPES);

  const prepared: PreparedTool[] = [];

  for (const [toolKey, tool] of Object.entries(tools)) {
    // Filter tools BEFORE registration based on granted scopes
    if (!isToolAllowed(tool.requiredScopes, grantedScopes)) {
      continue; // Skip this tool entirely
    }

    // Filter out constraint parameters from schema that will be auto-injected
    // Only filter parameters that are ACTUALLY constrained in the current context
    // to avoid breaking tools when constraints are not set
    const constraintKeysToFilter = new Set(
      getConstraintKeysToFilter(context.constraints, tool.inputSchema),
    );

    // Filter schema keys - use reduce for cleaner code than Object.fromEntries
    const filteredInputSchema: Record<string, z.ZodType> = Object.keys(
      tool.inputSchema,
    ).reduce(
      (acc, key) => {
        if (!constraintKeysToFilter.has(key)) {
          acc[key] = tool.inputSchema[key];
        }
        return acc;
      },
      {} as Record<string, z.ZodType>,
    );

    prepared.push({
      key: toolKey,
      tool,
      filteredInputSchema,
    });
  }

  return prepared;
}

/**
 * Applies constraints to tool parameters.
 *
 * Constraints ALWAYS overwrite user-provided parameters (security requirement).
 * This ensures users cannot bypass organizational/project/region restrictions.
 *
 * Handles parameter aliases (e.g., projectSlug → projectSlugOrId) automatically
 * via getConstraintParametersToInject helper.
 *
 * Used by both:
 * - buildServer: In tool execution handler
 * - prepareToolsForAgent: In agentTool wrapper
 *
 * @param params - User-provided parameters from tool call
 * @param constraints - Session-level constraints (org, project, region)
 * @param toolInputSchema - Original tool schema (to determine applicable constraints)
 * @returns Merged parameters with constraints applied (constraints overwrite user params)
 *
 * @example
 * ```typescript
 * const constraints = { organizationSlug: "my-org" };
 * const params = { query: "is:unresolved", organizationSlug: "other-org" };
 * const result = applyConstraints(params, constraints, tool.inputSchema);
 * // Returns: { query: "is:unresolved", organizationSlug: "my-org" }
 * // Constraint overwrites user's attempt to access different org
 * ```
 */
export function applyConstraints<TSchema extends Record<string, z.ZodType>>(
  params: Record<string, unknown>,
  constraints: ServerContext["constraints"],
  toolInputSchema: TSchema,
): z.infer<z.ZodObject<TSchema>> {
  // Returns the inferred type of the full schema
  // Runtime safety: params validated by Zod, constraints add missing fields
  const applicableConstraints = getConstraintParametersToInject(
    constraints,
    toolInputSchema,
  );

  return {
    ...params,
    ...applicableConstraints, // Constraints OVERWRITE user params (defense in depth)
  } as z.infer<z.ZodObject<TSchema>>;
}
