/**
 * Constraint application helpers for MCP server configuration.
 *
 * These functions handle the logic for filtering tool schemas and injecting
 * constraint parameters, including support for parameter aliases (e.g., projectSlug → projectSlugOrId).
 */
import type { Constraints } from "../types";
import type { z } from "zod";

/**
 * Determines which tool parameter keys should be filtered out of the schema
 * because they will be injected from constraints.
 *
 * Handles parameter aliases: when a projectSlug constraint exists and the tool
 * has a projectSlugOrId parameter, the alias will be applied UNLESS projectSlugOrId
 * is explicitly constrained with a truthy value.
 *
 * @param constraints - The active constraints (org, project, region)
 * @param toolInputSchema - The tool's input schema definition
 * @returns Array of parameter keys that should be filtered from the schema
 *
 * @example
 * ```typescript
 * const constraints = { projectSlug: "my-project", organizationSlug: "my-org" };
 * const schema = { organizationSlug: z.string(), projectSlugOrId: z.string() };
 * const keys = getConstraintKeysToFilter(constraints, schema);
 * // Returns: ["organizationSlug", "projectSlugOrId"]
 * // projectSlugOrId is included because projectSlug constraint will map to it
 * ```
 */
export function getConstraintKeysToFilter(
  constraints: Constraints,
  toolInputSchema: Record<string, z.ZodType>,
): string[] {
  return Object.entries(constraints).flatMap(([key, value]) => {
    // Skip non-string values (e.g., projectCapabilities object)
    if (!value || typeof value !== "string") return [];

    const keys: string[] = [];

    // If this constraint key exists in the schema, include it
    if (key in toolInputSchema) {
      keys.push(key);
    }

    // Special handling: projectSlug constraint can also apply to projectSlugOrId parameter
    // Only add the alias to filter if projectSlugOrId isn't being explicitly constrained
    if (
      key === "projectSlug" &&
      "projectSlugOrId" in toolInputSchema &&
      !("projectSlugOrId" in constraints && constraints.projectSlugOrId)
    ) {
      keys.push("projectSlugOrId");
    }

    return keys;
  });
}

/**
 * Builds the constraint parameters that should be injected into tool calls.
 *
 * Handles parameter aliases: when a projectSlug constraint exists and the tool
 * has a projectSlugOrId parameter, the constraint value will be injected as
 * projectSlugOrId UNLESS projectSlugOrId is explicitly constrained with a truthy value.
 *
 * @param constraints - The active constraints (org, project, region)
 * @param toolInputSchema - The tool's input schema definition
 * @returns Object mapping parameter names to constraint values
 *
 * @example
 * ```typescript
 * const constraints = { projectSlug: "my-project", organizationSlug: "my-org" };
 * const schema = { organizationSlug: z.string(), projectSlugOrId: z.string() };
 * const params = getConstraintParametersToInject(constraints, schema);
 * // Returns: { organizationSlug: "my-org", projectSlugOrId: "my-project" }
 * // projectSlug constraint is injected as projectSlugOrId parameter
 * ```
 */
export function getConstraintParametersToInject(
  constraints: Constraints,
  toolInputSchema: Record<string, z.ZodType>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(constraints).flatMap(([key, value]) => {
      // Skip non-string values (e.g., projectCapabilities object)
      if (!value || typeof value !== "string") return [];

      const entries: [string, string][] = [];

      // If this constraint key exists in the schema, add it
      if (key in toolInputSchema) {
        entries.push([key, value]);
      }

      // Special handling: projectSlug constraint can also apply to projectSlugOrId parameter
      // Only apply alias if the target parameter isn't already being constrained with a truthy value
      if (
        key === "projectSlug" &&
        "projectSlugOrId" in toolInputSchema &&
        !("projectSlugOrId" in constraints && constraints.projectSlugOrId)
      ) {
        entries.push(["projectSlugOrId", value]);
      }

      return entries;
    }),
  );
}
