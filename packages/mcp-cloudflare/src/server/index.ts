import OAuthProvider from "@cloudflare/workers-oauth-provider";
import * as Sentry from "@sentry/cloudflare";
import { SCOPES } from "../constants";
import app from "./app";
import sentryMcpHandler from "./lib/mcp-handler";
import { tokenExchangeCallback } from "./oauth";
import getSentryConfig from "./sentry.config";
import type { Env } from "./types";
import { getClientIp } from "./utils/client-ip";
import {
  addCorsHeaders,
  isPublicMetadataEndpoint,
  stripCorsHeaders,
} from "./utils/cors";
import { checkRateLimit } from "./utils/rate-limiter";

/**
 * RFC 9728 §3.1: Patch 401 responses on MCP routes to include a
 * `resource_metadata` parameter in the WWW-Authenticate header so
 * clients can discover the protected-resource metadata endpoint.
 */
function patchWwwAuthenticate(response: Response, url: URL): Response {
  if (response.status !== 401 || !url.pathname.startsWith("/mcp")) {
    return response;
  }
  const existing = response.headers.get("WWW-Authenticate");
  if (!existing) {
    return response;
  }
  const prmUrl = `${url.protocol}//${url.host}/.well-known/oauth-protected-resource/mcp`;
  const newResponse = new Response(response.body, response);
  // RFC 7235: first param is space-separated from scheme, subsequent params are comma-separated
  const separator = existing.includes(" ") ? "," : "";
  newResponse.headers.set(
    "WWW-Authenticate",
    `${existing}${separator} resource_metadata="${prmUrl}"`,
  );
  return newResponse;
}

// Wrap OAuth Provider to take control of CORS.
//
// @cloudflare/workers-oauth-provider v0.0.12 reflects the request Origin on
// every response it handles, effectively allowing any website to call our
// OAuth and MCP endpoints cross-origin. We wrap it to:
//   1. Intercept OPTIONS before the library — return our own preflight response.
//   2. Let the library handle the actual request normally.
//   3. On the way out, apply our CORS policy:
//      - Public metadata endpoints → restrictive read-only CORS (`*`, GET only)
//      - Everything else → strip all CORS headers the library added
const wrappedOAuthProvider = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url);

    // --- Phase 1: Intercept preflight before the library can respond ---
    // Public metadata gets restrictive CORS; everything else gets a bare 204
    // with no CORS headers so the browser blocks the cross-origin request.
    if (request.method === "OPTIONS") {
      if (isPublicMetadataEndpoint(url.pathname)) {
        return addCorsHeaders(new Response(null, { status: 204 }));
      }
      return new Response(null, { status: 204 });
    }

    // --- Rate limiting (before any OAuth/MCP processing) ---
    if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/oauth")) {
      const clientIP = getClientIp(request);

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
    }

    // --- Phase 2: Let the OAuth library handle the request ---
    // The library will add reflected-origin CORS headers to its responses.
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

    // --- Phase 3: Patch headers, then apply our CORS policy ---
    const patched = patchWwwAuthenticate(response, url);

    if (isPublicMetadataEndpoint(url.pathname)) {
      return addCorsHeaders(patched);
    }
    return stripCorsHeaders(patched);
  },
};

export default Sentry.withSentry(
  getSentryConfig,
  wrappedOAuthProvider,
) satisfies ExportedHandler<Env>;
