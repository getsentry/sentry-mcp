import * as Sentry from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import SentryMCP from "./lib/mcp-agent";
import app from "./app";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";

// required for Durable Objects
export { SentryMCP };

// SentryMCP handles URLPattern-based constraint extraction from request URLs
// and passes context to Durable Objects via headers for org/project scoping.

const oAuthProvider = new OAuthProvider({
  apiHandlers: {
    // OAuthProvider uses prefix matching, so "/mcp" matches all MCP routes.
    // SentryMCP.serve() uses URLPattern to extract org/project constraints from URLs.
    // SSE endpoints don't support subpath constraints due to protocol limitations.
    "/sse": SentryMCP.serveSSE("/sse"),
    "/mcp": SentryMCP.serve("/mcp/:org?/:project?"),
  },
  // @ts-ignore
  defaultHandler: app,
  // must match the routes registered in `app.ts`
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: Object.keys(SCOPES),
});

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

const addCorsHeaders = (response: Response): Response => {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Access-Control-Allow-Origin", "*");
  newResponse.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return newResponse;
};

// Wrap OAuth Provider to add CORS headers for public metadata endpoints
// This is necessary because the OAuth Provider handles some endpoints internally
// (.well-known) without going through our Hono app middleware
const corsWrappedOAuthProvider = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    // Handle CORS preflight for public metadata endpoints
    if (request.method === "OPTIONS") {
      const url = new URL(request.url);
      if (isPublicMetadataEndpoint(url.pathname)) {
        return addCorsHeaders(new Response(null, { status: 204 }));
      }
    }

    const response = await oAuthProvider.fetch(request, env, ctx);

    // Add CORS headers to public metadata endpoints
    const url = new URL(request.url);
    if (isPublicMetadataEndpoint(url.pathname)) {
      return addCorsHeaders(response);
    }

    return response;
  },
};

export default Sentry.withSentry(
  getSentryConfig,
  corsWrappedOAuthProvider,
) satisfies ExportedHandler<Env>;
