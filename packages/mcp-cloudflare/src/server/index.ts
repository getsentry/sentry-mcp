import OAuthProvider from "@cloudflare/workers-oauth-provider";
import * as Sentry from "@sentry/cloudflare";
import { SCOPES } from "../constants";
import app from "./app";
import { resolveClientFamily } from "./lib/client-family";
import sentryMcpHandler from "./lib/mcp-handler";
import {
  type RateLimitScope,
  extractResponseMetricOptions,
  recordResponseMetric,
  stripResponseMetricHeaders,
} from "./metrics";
import { tokenExchangeCallback } from "./oauth";
import getSentryConfig from "./sentry.config";
import type { Env } from "./types";
import { getClientIp } from "./utils/client-ip";
import {
  addCorsHeaders,
  isPublicMetadataEndpoint,
  stripCorsHeaders,
} from "./utils/cors";
import {
  MCP_RATE_LIMIT_EXCEEDED_MESSAGE,
  checkRateLimit,
} from "./utils/rate-limiter";
import { setSentryUserFromRequest } from "./utils/sentry-user";

/**
 * Splits a WWW-Authenticate Bearer challenge into its scheme and individual
 * `auth-param`s while respecting quoted-string commas. Returns `null` when
 * the header doesn't follow the `<scheme> <params>` shape we expect.
 */
function splitChallenge(
  headerValue: string,
): { scheme: string; params: string[] } | null {
  const firstSpace = headerValue.indexOf(" ");
  if (firstSpace === -1) return { scheme: headerValue, params: [] };
  const scheme = headerValue.slice(0, firstSpace);
  const rest = headerValue.slice(firstSpace + 1).trim();

  const params: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaping = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (escaping) {
      current += c;
      escaping = false;
      continue;
    }
    if (inQuotes && c === "\\") {
      current += c;
      escaping = true;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
      continue;
    }
    if (!inQuotes && c === ",") {
      const trimmed = current.trim();
      if (trimmed) params.push(trimmed);
      current = "";
      continue;
    }
    current += c;
  }
  if (inQuotes) return null;
  const trimmed = current.trim();
  if (trimmed) params.push(trimmed);
  return { scheme, params };
}

/**
 * RFC 9728 §3.1: Patch 401 responses on MCP routes to include a
 * `resource_metadata` parameter in the WWW-Authenticate header so
 * clients can discover the protected-resource metadata endpoint.
 *
 * The underlying OAuth library may already set its own `resource_metadata`
 * pointing at the (path-less) origin metadata URL, which 404s on this
 * deployment. We strip any pre-existing `resource_metadata` parameter and
 * replace it with our path-specific one so the challenge contains exactly
 * one such param, as required by RFC 9110 §11.2.
 */
function patchWwwAuthenticate(response: Response, url: URL): Response {
  if (response.status !== 401 || !url.pathname.startsWith("/mcp")) {
    return response;
  }
  const existing = response.headers.get("WWW-Authenticate");
  if (!existing) {
    return response;
  }
  const prmUrl = `${url.protocol}//${url.host}/.well-known/oauth-protected-resource${url.pathname}${url.search}`;
  const newResponse = new Response(response.body, response);

  const parsed = splitChallenge(existing);
  if (!parsed) {
    // Fall back to a freshly built challenge if the existing header doesn't
    // parse cleanly; better to send a single valid challenge than to risk
    // emitting another malformed one.
    newResponse.headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${prmUrl}"`,
    );
    return newResponse;
  }

  const filteredParams = parsed.params.filter(
    (p) => !/^resource_metadata\s*=/i.test(p),
  );
  filteredParams.push(`resource_metadata="${prmUrl}"`);
  newResponse.headers.set(
    "WWW-Authenticate",
    `${parsed.scheme} ${filteredParams.join(", ")}`,
  );
  return newResponse;
}

function finalizeResponse(
  request: Request,
  url: URL,
  response: Response,
  options?: {
    rateLimitScope?: RateLimitScope;
    responseReason?: "local_rate_limit";
  },
): Response {
  const responseMetricOptions = extractResponseMetricOptions(response);
  const responseWithoutMetricHeaders = stripResponseMetricHeaders(response);
  const finalized = isPublicMetadataEndpoint(url.pathname)
    ? addCorsHeaders(responseWithoutMetricHeaders)
    : stripCorsHeaders(responseWithoutMetricHeaders);

  recordResponseMetric(request, finalized, {
    ...responseMetricOptions,
    ...options,
  });
  return finalized;
}

// Wrap OAuth Provider to take control of CORS.
//
// The OAuth provider manages several routes directly and may attach its own
// CORS headers to the responses it handles. We wrap it to:
//   1. Intercept OPTIONS before the library — return our own preflight response.
//   2. Let the library handle the actual request normally.
//   3. On the way out, apply our CORS policy:
//      - Public metadata endpoints → restrictive read-only CORS (`*`, GET only)
//      - Everything else → strip all CORS headers the library added
const wrappedOAuthProvider = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url);
    setSentryUserFromRequest(request);

    // --- Phase 1: Intercept preflight before the library can respond ---
    // Public metadata gets restrictive CORS; everything else gets a bare 204
    // with no CORS headers so the browser blocks the cross-origin request.
    if (request.method === "OPTIONS") {
      if (isPublicMetadataEndpoint(url.pathname)) {
        return finalizeResponse(
          request,
          url,
          new Response(null, { status: 204 }),
        );
      }
      return finalizeResponse(
        request,
        url,
        new Response(null, { status: 204 }),
      );
    }

    // RFC 9728 metadata must be derived from the exact protected resource
    // identifier. We expose only path-specific metadata for `/mcp...`.
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return finalizeResponse(
        request,
        url,
        new Response("Not Found", { status: 404 }),
      );
    }

    // --- Rate limiting (before any OAuth/MCP processing) ---
    if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/oauth")) {
      const clientIP = getClientIp(request);

      if (clientIP) {
        const rateLimitResult = await checkRateLimit(
          clientIP,
          env.MCP_IP_RATE_LIMITER ?? env.MCP_RATE_LIMITER,
          {
            keyPrefix: "mcp:ip",
            errorMessage: MCP_RATE_LIMIT_EXCEEDED_MESSAGE,
          },
        );

        if (!rateLimitResult.allowed) {
          return finalizeResponse(
            request,
            url,
            new Response(rateLimitResult.errorMessage, { status: 429 }),
            {
              responseReason: "local_rate_limit",
              rateLimitScope: "ip",
            },
          );
        }
      }
    }

    const clientFamily = resolveClientFamily(request.headers.get("user-agent"));

    // --- Phase 2: Let the OAuth library handle the request ---
    // We normalize any CORS headers it returns in the response handling below.
    const oAuthProvider = new OAuthProvider({
      apiRoute: "/mcp",
      // @ts-expect-error - OAuthProvider types don't support specific Env types
      apiHandler: sentryMcpHandler,
      defaultHandler: app,
      // must match the routes registered in `app.ts`
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      tokenExchangeCallback: (options) =>
        tokenExchangeCallback(options, env, request, clientFamily),
      scopesSupported: Object.keys(SCOPES),
      // Expire grants after 30 days to prevent unbounded KV accumulation.
      // Sentry access tokens also have a 30-day lifetime, so re-auth is
      // required after this window regardless.
      refreshTokenTTL: 30 * 24 * 60 * 60,
    });

    const response = await oAuthProvider.fetch(request, env, ctx);

    if (
      request.method === "POST" &&
      url.pathname === "/oauth/register" &&
      response.ok
    ) {
      Sentry.metrics.count("mcp.oauth.register", 1, {
        attributes: { client_family: clientFamily },
      });
    }

    // --- Phase 3: Patch headers, then apply our CORS policy ---
    const patched = patchWwwAuthenticate(response, url);
    return finalizeResponse(request, url, patched);
  },
};

export default Sentry.withSentry(
  getSentryConfig,
  wrappedOAuthProvider,
) satisfies ExportedHandler<Env>;
