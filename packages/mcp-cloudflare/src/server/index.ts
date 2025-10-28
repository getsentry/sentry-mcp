import * as Sentry from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import app from "./app";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";
import { tokenExchangeCallback } from "./oauth";
import sentryMcpHandler from "./lib/mcp-handler";
import { SentryMCP as SentryMCPStub } from "./lib/mcp-agent-stub";

// SentryMCP stub exported ONLY for Durable Object migration purposes.
// This will be removed after the deleted_classes migration completes.

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

// Wrap OAuth Provider to restrict CORS headers on public metadata endpoints
// OAuth Provider v0.0.12 adds overly permissive CORS (allows all methods/headers).
// We override with secure headers for .well-known endpoints and add CORS to robots.txt/llms.txt.
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
      apiRoute: "/mcp",
      // @ts-expect-error - OAuthProvider types don't support specific Env types
      apiHandler: sentryMcpHandler,
      // @ts-expect-error - OAuthProvider types don't support specific Env types
      defaultHandler: app,
      // must match the routes registered in `app.ts`
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
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

export default Sentry.withSentry(
  getSentryConfig,
  corsWrappedOAuthProvider,
) satisfies ExportedHandler<Env>;

// Export SentryMCP Durable Object class for migration
// TEMPORARY: This export is required for Cloudflare to apply the deleted_classes migration.
// Once all Durable Object instances are deleted, this export should be removed.
export { SentryMCPStub as SentryMCP };
