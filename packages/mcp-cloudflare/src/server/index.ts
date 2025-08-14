import * as Sentry from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import SentryMCP from "./lib/mcp-transport";
import { createConstraintAwareMcpHandler } from "./lib/mcp-constraint-handler";
import app from "./app";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";

// required for Durable Objects
export { SentryMCP };

const oAuthProvider = new OAuthProvider({
  apiHandlers: {
    // Use constraint-aware handlers that support dynamic URL segments
    // These handlers will match /mcp, /mcp/org, /mcp/org/project etc.
    // because the OAuth provider uses startsWith for path matching
    "/sse": createConstraintAwareMcpHandler("/sse"),
    "/mcp": createConstraintAwareMcpHandler("/mcp"),
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
