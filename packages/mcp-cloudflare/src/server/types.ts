import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { ServerContext } from "@sentry/mcp-server/types";

export type WorkerProps = ServerContext & {
  id: string;
  name: string;
  scope: string;
};

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
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  AI: Ai;
}
