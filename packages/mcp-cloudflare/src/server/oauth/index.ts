// Re-export the main OAuth Hono app
export { default } from "./routes/index";

// Re-export helper functions and constants for external use
export {
  SENTRY_AUTH_URL,
  SENTRY_TOKEN_URL,
  TokenResponseSchema,
} from "./constants";
export {
  getUpstreamAuthorizeUrl,
  exchangeCodeForAccessToken,
  refreshAccessToken,
  validateResourceParameter,
  createResourceValidationError,
  createOAuthHelpers,
  type OAuthHelpers,
} from "./helpers";

// Re-export types
export * from "./types";

// Re-export storage
export {
  KVStorage,
  InMemoryStorage,
  createKVStorage,
  createInMemoryStorage,
} from "./storage";
export type { OAuthStorage } from "./storage";

// Re-export crypto utilities
export * from "./crypto";

// Re-export middleware
export { bearerAuth, requireScope, type AuthContext } from "./middleware/auth";

// Re-export metadata route for .well-known
export { default as metadataRoute } from "./routes/metadata";
