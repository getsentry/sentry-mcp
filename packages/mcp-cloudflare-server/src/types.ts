import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type {
  RateLimit,
  WorkerVersionMetadata,
} from "@cloudflare/workers-types";

/**
 * Environment bindings for the MCP Server worker
 *
 * This worker uses OAuthProvider for token validation. The OAuthProvider
 * validates Bearer tokens and decrypts the encrypted props (user context)
 * stored in KV. Both workers share the same OAUTH_KV namespace.
 *
 * Note: OAUTH_PROVIDER is automatically injected by the OAuthProvider wrapper.
 */
export interface Env {
  // OAuth Provider helpers (injected by OAuthProvider wrapper)
  // Used to revoke legacy grants that lack grantedSkills
  OAUTH_PROVIDER: OAuthHelpers;

  // KV for OAuth token storage (shared with OAuth worker)
  // Required for OAuthProvider to validate tokens and retrieve encrypted props
  OAUTH_KV: KVNamespace;

  // Version metadata for Sentry
  CF_VERSION_METADATA: WorkerVersionMetadata;

  // Rate limiting (applied by router, but available here for future use)
  MCP_RATE_LIMITER: RateLimit;

  // Environment variables
  SENTRY_HOST?: string;
  MCP_URL?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  OPENAI_API_KEY?: string; // For search_events/search_issues AI agents

  // OAuth configuration
  SENTRY_CLIENT_ID: string;
  SENTRY_CLIENT_SECRET: string;
  COOKIE_SECRET: string;
}

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
