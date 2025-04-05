import { withSentry } from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import app from "./app";
import SentryMCP from "./mcp/server";
import { SCOPES } from "./routes/auth";

// required for Durable Objects
export { default as SentryMCP } from "./mcp/server";

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
    // @ts-ignore
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1,
    environment: env.NODE_ENV === "production" ? "production" : "development",
  }),
  oAuthProvider,
);
