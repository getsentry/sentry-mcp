/**
 * Core type system for MCP tools.
 *
 * Defines TypeScript types derived from tool definitions, handler signatures,
 * and server context. Uses advanced TypeScript patterns for type-safe parameter
 * extraction and handler registration.
 */
import type { Scope } from "./permissions";
import type { Skill } from "./skills";

/**
 * Constraints that restrict the MCP session scope
 */
export type Constraints = {
  organizationSlug?: string | null;
  projectSlug?: string | null;
  regionUrl?: string | null;
};

/**
 * Tool parameter keys that can be auto-injected from constraints.
 * These are filtered from tool schemas when constraints are active.
 */
export const CONSTRAINT_PARAMETER_KEYS = new Set<string>([
  "organizationSlug",
  "projectSlug",
  "projectSlugOrId", // Alias for projectSlug
  "regionUrl",
]);

export type ServerContext = {
  sentryHost?: string;
  mcpUrl?: string;
  accessToken: string;
  openaiBaseUrl?: string;
  userId?: string | null;
  clientId?: string;
  // NEW: Granted skills for tool access control (user-facing capabilities)
  grantedSkills?: Set<Skill> | ReadonlySet<Skill>;
  // LEGACY: Granted scopes for tool access control (deprecated, for backward compatibility)
  grantedScopes?: Set<Scope> | ReadonlySet<Scope>;
  // URL-based session constraints
  constraints: Constraints;
};
