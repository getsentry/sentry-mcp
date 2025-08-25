import * as Sentry from "@sentry/cloudflare";
import { createOAuthMiddleware } from "@sentry/hono-oauth-provider";
import SentryMCP from "./lib/mcp-transport"; // Keep for SSE support
import app from "./app";
import mcpRoutes from "./routes/mcp";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";

// Required for Durable Objects (SSE support)
export { SentryMCP };

// Mount MCP routes on the main app
app.route("/mcp", mcpRoutes);

// Keep SSE support using existing Durable Objects implementation
// This maintains backward compatibility
app.all("/sse/*", async (c) => {
  const handler = SentryMCP.serveSSE("/sse");
  return handler.fetch(c.req.raw, c.env, c.executionCtx);
});

// Configure OAuth middleware for the entire app
const oauthMiddleware = createOAuthMiddleware({
  // API handlers are now regular Hono routes with auth middleware
  // No need to specify them here
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: Object.keys(SCOPES),
  accessTokenTTL: 3600, // 1 hour
});

// Apply OAuth middleware to the app
app.use("*", oauthMiddleware);

// Public metadata endpoints that should be accessible from any origin
const PUBLIC_METADATA_PATHS = [
  "/.well-known/", // OAuth discovery endpoints
  "/robots.txt", // Search engine directives
  "/llms.txt", // LLM/AI agent directives
];

const isPublicMetadataEndpoint = (pathname: string): boolean => {
  return PUBLIC_METADATA_PATHS.some((path) =>
    path.endsWith("/") ? pathname.startsWith(path) : pathname === path,
  );
};

// Add CORS middleware for public metadata endpoints
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  
  // Handle CORS preflight for public metadata endpoints
  if (c.req.method === "OPTIONS" && isPublicMetadataEndpoint(url.pathname)) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  
  await next();
  
  // Add CORS headers to public metadata endpoints
  if (isPublicMetadataEndpoint(url.pathname)) {
    c.res.headers.set("Access-Control-Allow-Origin", "*");
    c.res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    c.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
});

// Export the Hono app directly with Sentry wrapper
export default Sentry.withSentry(
  getSentryConfig,
  app,
) satisfies ExportedHandler<Env>;