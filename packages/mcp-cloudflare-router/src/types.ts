import type {
  RateLimit,
  WorkerVersionMetadata,
} from "@cloudflare/workers-types";

/**
 * Environment bindings for the Router worker
 */
export interface Env {
  // Service bindings (HTTP fetch)
  WEB_SERVICE: Fetcher;
  SERVER_SERVICE: Fetcher;

  // Version metadata for Sentry
  CF_VERSION_METADATA: WorkerVersionMetadata;

  // Rate limiting
  MCP_RATE_LIMITER: RateLimit;

  // Environment variables
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_HOST?: string;
}
