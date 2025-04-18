import { withSentry } from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import SentryMCP from "./mcp-transport";
import { SCOPES } from "./auth";
import app from "./app";
import type { Env } from "./types";

// required for Durable Objects
export { SentryMCP };

const oAuthProvider = new OAuthProvider({
  apiRoute: "/sse",
  // @ts-ignore
  apiHandler: SentryMCP.mount("/sse"),
  // @ts-ignore
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: SCOPES.split(" "),
});

export default withSentry(
  (env) => ({
    debug: env.NODE_ENV !== "production",
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1,
    sendDefaultPii: true,
    environment: env.NODE_ENV === "production" ? "production" : "development",
  }),
  oAuthProvider,
) satisfies ExportedHandler<Env>;
