import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type {
  RateLimit,
  WorkerVersionMetadata,
} from "@cloudflare/workers-types";
import type { AgentNamespace } from "agents";
import type { McpSession } from "./session";

/**
 * Props passed through OAuth and available via ExecutionContext.props
 *
 * These props are set in the OAuth callback and become available
 * to the MCP handler through ExecutionContext.props (set by OAuth provider).
 */
export type WorkerProps = {
  // OAuth standard fields
  id: string;

  // Sentry-specific fields
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number; // Timestamp when the upstream access token expires
  clientId: string;
  scope: string;
  // Scopes derived from skills - for backward compatibility with old MCP clients
  // that don't support grantedSkills and only understand grantedScopes
  grantedScopes?: string[];
  grantedSkills?: string[]; // Array of skill strings (primary authorization method)

  // Note: constraints are NOT included - they're extracted per-request from URL
  // Note: sentryHost and mcpUrl come from env, not OAuth props
};

/**
 * Serializable version of ServerContext for RPC transport.
 *
 * This type is used to pass authentication and authorization context
 * from the router to the McpSession Agent via ExecutionContext.props.
 *
 * Key differences from ServerContext (mcp-core/types):
 * - Uses string[] instead of Set<Scope>/Set<Skill> (Sets don't serialize over RPC)
 * - Uses flat organizationSlug/projectSlug instead of nested Constraints object
 * - Includes isAgentMode flag for dynamic server configuration
 *
 * The Agent converts this back to ServerContext format for use by tools.
 */
export interface SerializableServerContext {
  userId?: string;
  clientId: string;
  accessToken: string;
  grantedScopes?: string[];
  grantedSkills?: string[];
  organizationSlug?: string | null;
  projectSlug?: string | null;
  sentryHost: string;
  mcpUrl?: string;
  isAgentMode?: boolean;
}

export interface Env {
  NODE_ENV: string;
  ASSETS: Fetcher;
  OAUTH_KV: KVNamespace;
  COOKIE_SECRET: string;
  SENTRY_CLIENT_ID: string;
  SENTRY_CLIENT_SECRET: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_DSN?: string;
  SENTRY_HOST?: string;
  OPENAI_API_KEY: string;
  MCP_URL?: string;
  OAUTH_PROVIDER: OAuthHelpers;
  AI: Ai;
  CF_VERSION_METADATA: WorkerVersionMetadata;
  CHAT_RATE_LIMITER: RateLimit;
  SEARCH_RATE_LIMITER: RateLimit;
  MCP_RATE_LIMITER: RateLimit;
  AUTORAG_INDEX_NAME?: string;
  MCP_SESSION: AgentNamespace<McpSession>;
}
