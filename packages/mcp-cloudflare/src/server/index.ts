import * as Sentry from "@sentry/cloudflare";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import app from "./app";
import { SCOPES } from "../constants";
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";
import { tokenExchangeCallback } from "./oauth";
import sentryMcpHandler from "./lib/mcp-handler";
import { checkRateLimit } from "./utils/rate-limiter";
import { getClientIp } from "./utils/client-ip";

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
const wrappedOAuthProvider = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url);

    // Handle CORS preflight for public metadata endpoints
    if (request.method === "OPTIONS") {
      if (isPublicMetadataEndpoint(url.pathname)) {
        return addCorsHeaders(new Response(null, { status: 204 }));
      }
    }

    // Apply rate limiting to MCP and OAuth routes
    // This protects against abuse at the earliest possible point
    if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/oauth")) {
      const clientIP = getClientIp(request);

      // In local development or when IP can't be extracted, skip rate limiting
      // Rate limiter is optional and primarily for production abuse prevention
      if (clientIP) {
        const rateLimitResult = await checkRateLimit(
          clientIP,
          env.MCP_RATE_LIMITER,
          {
            keyPrefix: "mcp",
            errorMessage:
              "Rate limit exceeded. Please wait before trying again.",
          },
        );

        if (!rateLimitResult.allowed) {
          return new Response(rateLimitResult.errorMessage, { status: 429 });
        }
      }
      // If no clientIP, allow the request (likely local dev)
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

    // Flush buffered logs before Worker terminates
    ctx.waitUntil(Sentry.flush(2000));

    // Add CORS headers to public metadata endpoints
    if (isPublicMetadataEndpoint(url.pathname)) {
      return addCorsHeaders(response);
    }

    return response;
  },
};

export default Sentry.withSentry(
  getSentryConfig,
  wrappedOAuthProvider,
) satisfies ExportedHandler<Env>;
