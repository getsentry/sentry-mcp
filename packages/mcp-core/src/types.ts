/**
 * Core type system for MCP tools.
 *
 * Defines TypeScript types derived from tool definitions, handler signatures,
 * and server context. Uses advanced TypeScript patterns for type-safe parameter
 * extraction and handler registration.
 */
import type { Skill } from "./skills";

/**
 * Project capabilities indicating what data types the project has
 */
export type ProjectCapabilities = {
  profiles?: boolean;
  replays?: boolean;
  logs?: boolean;
  traces?: boolean;
};

/**
 * Constraints that restrict the MCP session scope
 */
export type Constraints = {
  organizationSlug?: string | null;
  projectSlug?: string | null;
  regionUrl?: string | null;
  projectCapabilities?: ProjectCapabilities | null;
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

export type TransportType = "stdio" | "http";

export type ServerContext = {
  sentryHost?: string;
  mcpUrl?: string;
  accessToken: string;
  openaiBaseUrl?: string;
  userId?: string | null;
  clientId?: string;
  /** Primary authorization method - granted skills for tool access control */
  grantedSkills?: Set<Skill> | ReadonlySet<Skill>;
  // URL-based session constraints
  constraints: Constraints;
  /** Whether agent mode is enabled (only use_sentry tool exposed) */
  agentMode?: boolean;
  /** Whether experimental tools are enabled */
  experimentalMode?: boolean;
  /** Transport type - affects error message formatting */
  transport?: TransportType;
};
