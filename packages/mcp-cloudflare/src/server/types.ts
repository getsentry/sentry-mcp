import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type {
  RateLimit,
  WorkerVersionMetadata,
} from "@cloudflare/workers-types";

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
  /**
   * @deprecated grantedScopes is deprecated and will be removed on Jan 1, 2026.
   * Use grantedSkills instead. Skills are the primary authorization method.
   * This field exists only for backward compatibility during the transition period.
   */
  grantedScopes?: string[];
  /** Primary authorization method - array of skill strings */
  grantedSkills?: string[];

  // Note: constraints are NOT included - they're extracted per-request from URL
  // Note: sentryHost and mcpUrl come from env, not OAuth props
};

export interface Env {
  NODE_ENV: string;
  ASSETS: Fetcher;
  OAUTH_KV: KVNamespace;
  MCP_CACHE: KVNamespace;
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
}
