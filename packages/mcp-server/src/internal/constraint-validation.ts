/**
 * Constraint validation for organization and project scoping.
 *
 * Enforces URL-derived constraints to prevent cross-organization/project operations.
 * When a session is scoped to a specific organization or project via the URL path,
 * all operations must respect those constraints.
 */
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";

export interface ConstraintParams {
  organizationSlug?: string;
  projectSlug?: string;
  projectSlugOrId?: string;
}

/**
 * Validates that the requested parameters match the session constraints.
 *
 * @param params - The organization/project parameters from the tool request
 * @param context - The server context containing session constraints
 * @throws UserInputError if constraints are violated
 */
export function validateConstraints(
  params: ConstraintParams,
  context: ServerContext,
): void {
  const constraints = context.constraints;

  // No constraints = allow all operations
  if (!constraints) {
    return;
  }

  // Validate organization constraint
  if (constraints.organizationSlug && params.organizationSlug) {
    if (params.organizationSlug !== constraints.organizationSlug) {
      throw new UserInputError(
        `Organization constraint violation: This session is restricted to organization '${constraints.organizationSlug}' but you tried to access '${params.organizationSlug}'. This MCP session was initialized with organization-specific constraints for security.`,
      );
    }
  }

  // Validate project constraint
  if (constraints.projectSlug) {
    // Check projectSlug parameter
    if (params.projectSlug && params.projectSlug !== constraints.projectSlug) {
      throw new UserInputError(
        `Project constraint violation: This session is restricted to project '${constraints.projectSlug}' but you tried to access '${params.projectSlug}'. This MCP session was initialized with project-specific constraints for security.`,
      );
    }

    // Check projectSlugOrId parameter (used by some tools)
    if (
      params.projectSlugOrId &&
      params.projectSlugOrId !== constraints.projectSlug
    ) {
      throw new UserInputError(
        `Project constraint violation: This session is restricted to project '${constraints.projectSlug}' but you tried to access '${params.projectSlugOrId}'. This MCP session was initialized with project-specific constraints for security.`,
      );
    }
  }
}

/**
 * Applies constraints to parameters by setting them from the context if not provided.
 * This is useful for tools that have optional organization/project parameters.
 *
 * @param params - The original parameters
 * @param context - The server context containing session constraints
 * @returns Parameters with constraints applied
 */
export function applyConstraints<T extends ConstraintParams>(
  params: T,
  context: ServerContext,
): T {
  const constraints = context.constraints;

  if (!constraints) {
    return params;
  }

  const result = { ...params };

  // Apply organization constraint if not specified
  if (constraints.organizationSlug && !result.organizationSlug) {
    result.organizationSlug = constraints.organizationSlug;
  }

  // Apply project constraint if not specified
  if (constraints.projectSlug) {
    if (!result.projectSlug) {
      result.projectSlug = constraints.projectSlug;
    }
    if (!result.projectSlugOrId) {
      result.projectSlugOrId = constraints.projectSlug;
    }
  }

  return result;
}

/**
 * Checks if the current session has any constraints.
 */
export function hasConstraints(context: ServerContext): boolean {
  return Boolean(context.constraints);
}

/**
 * Checks if the current session has organization constraint.
 */
export function hasOrganizationConstraint(context: ServerContext): boolean {
  return Boolean(context.constraints?.organizationSlug);
}

/**
 * Checks if the current session has project constraint.
 */
export function hasProjectConstraint(context: ServerContext): boolean {
  return Boolean(context.constraints?.projectSlug);
}
