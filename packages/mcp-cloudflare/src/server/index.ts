import * as Sentry from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import SentryMCP from "./lib/mcp-transport";
import app from "./app";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";

// required for Durable Objects
export { SentryMCP };

const oAuthProvider = new OAuthProvider({
  apiHandlers: {
    "/sse": SentryMCP.mount("/sse"),
    "/mcp": SentryMCP.mount("/mcp"),
  },
  // @ts-ignore
  defaultHandler: app,
  // must match the routes registered in `app.ts`
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: Object.keys(SCOPES),
});

export default Sentry.withSentry(
  getSentryConfig,
  oAuthProvider,
) satisfies ExportedHandler<Env>;
