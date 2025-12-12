import type {
  RateLimit,
  WorkerVersionMetadata,
} from "@cloudflare/workers-types";

/**
 * Environment bindings for the Web worker
 *
 * This worker serves the React SPA and handles chat-related APIs.
 */
export interface Env {
  NODE_ENV: string;

  // Version metadata for Sentry
  CF_VERSION_METADATA: WorkerVersionMetadata;

  // Static assets
  ASSETS: Fetcher;

  // AI for AutoRAG
  AI: Ai;

  // Rate limiting
  CHAT_RATE_LIMITER: RateLimit;
  SEARCH_RATE_LIMITER: RateLimit;

  // KV for chat client registration
  OAUTH_KV: KVNamespace;

  // Environment variables
  COOKIE_SECRET: string;
  SENTRY_CLIENT_ID: string;
  SENTRY_CLIENT_SECRET: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_DSN?: string;
  SENTRY_HOST?: string;
  OPENAI_API_KEY: string;
  MCP_URL?: string;
  AUTORAG_INDEX_NAME?: string;
}
