import * as Sentry from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import SentryMCP from "./lib/mcp-transport";
import app from "./app";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";

// required for Durable Objects
export { SentryMCP };

// Custom wrapper to preserve path parameters via headers.
//
// Why this hack is necessary:
// 1. OAuthProvider only supports prefix matching (e.g., "/mcp" matches "/mcp/*")
// 2. The agents library's serve() method rewrites the URL path to "/streamable-http"
//    before passing it to the Durable Object, losing the original path information
// 3. We need to extract org/project from paths like "/mcp/sentry/javascript"
//
// Solution: Extract path parameters here and pass them as custom headers,
// which are preserved through the serve() URL rewriting.
const createMcpHandler = (basePath: string, isSSE = false) => {
  const handler = isSSE ? SentryMCP.serveSSE("/*") : SentryMCP.serve("/*");

  return {
    fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
      const url = new URL(request.url);

      // Always create new headers to prevent external manipulation
      const headers = new Headers(request.headers);

      // Remove any externally-set constraint headers for security
      // This prevents clients from bypassing URL-based constraints
      headers.delete("X-Sentry-Org-Slug");
      headers.delete("X-Sentry-Project-Slug");

      // Extract org/project from URL path
      const pathMatch = url.pathname.match(
        /^\/(mcp|sse)(?:\/([a-zA-Z0-9._-]{1,100}))?(?:\/([a-zA-Z0-9._-]{1,100}))?/,
      );

      // Set headers based on URL path if org/project are present
      if (pathMatch?.[2]) {
        headers.set("X-Sentry-Org-Slug", pathMatch[2]);
        if (pathMatch[3]) {
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
    // We use a custom wrapper to extract path params and pass them as headers
    "/sse": createMcpHandler("/sse", true),
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

export default Sentry.withSentry(
  getSentryConfig,
  oAuthProvider,
) satisfies ExportedHandler<Env>;
