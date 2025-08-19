import * as Sentry from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import SentryMCP from "./lib/mcp-transport";
import app from "./app";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";
import { isValidSlug } from "./lib/slug-validation";

// required for Durable Objects
export { SentryMCP };

// Custom wrapper to preserve path parameters via headers.
//
// ARCHITECTURAL LIMITATION:
// We must pass constraints via headers because the agents library rewrites URLs
// from /mcp/org/project to /streamable-http, losing path information.
//
// IDEAL SOLUTION (not possible with current libraries):
// Each URL path (/mcp/org1/project1) would map to a separate DO instance,
// providing immutable configuration per context.
//
// CURRENT SOLUTION:
// 1. Extract org/project from URL path here
// 2. Pass as headers (X-Sentry-Org-Slug, X-Sentry-Project-Slug)
// 3. DO extracts headers and reconfigures when constraints change
//
// This wrapper ensures:
// - Security: External clients cannot bypass URL-based constraints
// - Validation: Slugs are validated before being passed to DO
// - Compatibility: Works with both SSE and streamable-http transports
const createMcpHandler = (basePath: string, isSSE = false) => {
  const handler = isSSE ? SentryMCP.serveSSE("/*") : SentryMCP.serve("/*");

  return {
    fetch: (request: Request, env: unknown, ctx: ExecutionContext) => {
      const url = new URL(request.url);

      // Always create new headers to prevent external manipulation
      const headers = new Headers(request.headers);

      // Remove any externally-set constraint headers for security
      // This prevents clients from bypassing URL-based constraints
      headers.delete("X-Sentry-Org-Slug");
      headers.delete("X-Sentry-Project-Slug");

      // Extract org/project from URL path
      // NOTE: Extra path segments after project (e.g., /mcp/org/project/extra) are
      // intentionally ignored - the MCP handler manages any additional routing
      // IMPORTANT: /sse/message and /mcp/message are reserved SSE protocol endpoints
      // and must not be interpreted as organization slugs
      const pathMatch = url.pathname.match(
        /^\/(mcp|sse)(?:\/([a-zA-Z0-9._-]{1,100}))?(?:\/([a-zA-Z0-9._-]{1,100}))?/,
      );

      // Check if this is a reserved protocol endpoint
      const isReservedEndpoint =
        url.pathname === "/sse/message" ||
        url.pathname.startsWith("/sse/message?") ||
        url.pathname === "/mcp/message" ||
        url.pathname.startsWith("/mcp/message?");

      // Validate and set headers based on URL path (unless it's a reserved endpoint)
      if (!isReservedEndpoint && pathMatch?.[2]) {
        // Organization slug is present - validate it
        if (!isValidSlug(pathMatch[2])) {
          return new Response(
            JSON.stringify({
              error: "invalid_request",
              error_description: "Invalid organization slug format",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        headers.set("X-Sentry-Org-Slug", pathMatch[2]);

        // Project slug is optional but must be valid if present
        if (pathMatch[3]) {
          if (!isValidSlug(pathMatch[3])) {
            return new Response(
              JSON.stringify({
                error: "invalid_request",
                error_description: "Invalid project slug format",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          headers.set("X-Sentry-Project-Slug", pathMatch[3]);
        }
      }
      // If no path params, headers remain deleted (cleared above)

      // Create a new request with the sanitized headers
      const modifiedRequest = new Request(request, { headers });
      return handler.fetch(modifiedRequest, env, ctx);
    },
  };
};

const oAuthProvider = new OAuthProvider({
  apiHandlers: {
    // NOTE: OAuthProvider only does prefix matching, not parameterized routes.
    // So "/mcp" will match "/mcp", "/mcp/org", "/mcp/org/project" etc.
    // We use a custom wrapper to extract path params for /mcp endpoints only.
    // SSE endpoints don't support subpath constraints due to protocol limitations.
    "/sse": SentryMCP.serveSSE("/sse"),
    "/mcp": createMcpHandler("/mcp", false),
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
