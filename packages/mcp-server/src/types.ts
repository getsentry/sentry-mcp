/**
 * Core type system for MCP tools.
 *
 * Defines TypeScript types derived from tool definitions, handler signatures,
 * and server context. Uses advanced TypeScript patterns for type-safe parameter
 * extraction and handler registration.
 */
import type { Scope } from "./permissions";

/**
 * Constraints that restrict the MCP session scope
 */
export type Constraints = {
  organizationSlug?: string | null;
  projectSlug?: string | null;
  regionUrl?: string | null;
};

export type ServerContext = {
  sentryHost?: string;
  mcpUrl?: string;
  accessToken: string;
  openaiBaseUrl?: string;
  userId?: string | null;
  clientId?: string;
  // Granted scopes for tool access control
  grantedScopes?: Set<Scope> | ReadonlySet<Scope>;
  // URL-based session constraints
  constraints: Constraints;
};
