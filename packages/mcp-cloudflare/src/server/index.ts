import * as Sentry from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import sentryMcpHandler, { SentryMCP } from "./lib/mcp-agent";
import app from "./app";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";
import { tokenExchangeCallback } from "./oauth";

// required for Durable Objects
export { SentryMCP };

// SentryMCP handles URLPattern-based constraint extraction from request URLs
// and passes context to Durable Objects via headers for org/project scoping.

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

    const oAuthProvider = new OAuthProvider({
      apiRoute: ["/sse", "/mcp"],
      apiHandler: sentryMcpHandler,
      // @ts-ignore
      defaultHandler: app,
      // must match the routes registered in `app.ts`
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      // @ts-ignore - Environment will be passed as second parameter
      tokenExchangeCallback: (options) => tokenExchangeCallback(options, env),
      scopesSupported: Object.keys(SCOPES),
    });

    const response = await oAuthProvider.fetch(request, env, ctx);

    // Add CORS headers to public metadata endpoints
    const url = new URL(request.url);
    if (isPublicMetadataEndpoint(url.pathname)) {
      return addCorsHeaders(response);
    }

    return response;
  },
};

const baseHandler = Sentry.withSentry(
  getSentryConfig,
  corsWrappedOAuthProvider,
) as ExportedHandler<Env>;

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/docs")) {
        return env.DOCS.fetch(request);
      }
    } catch (error: unknown) {
      // Maintain minimal logging and avoid leaking secrets
      const err = error as Error;
      // eslint-disable-next-line no-console
      console.error("[ERROR]", err.message, err.stack);
    }

    return baseHandler.fetch!(request, env, ctx);
  },
};

export default handler;
