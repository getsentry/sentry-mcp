import OAuthProvider from "@cloudflare/workers-oauth-provider";
import * as Sentry from "@sentry/cloudflare";
import { logWarn } from "@sentry/mcp-core/telem/logging";
import { SCOPES } from "../constants";
import app from "./app";
import {
  UTM_SOURCE_ATTRIBUTE,
  resolveUtmSourceFromUrl,
} from "./lib/attribution";
import { resolveClientFamily } from "./lib/client-family";
import { redirectUriHasUserInfo } from "./lib/html-utils";
import sentryMcpHandler from "./lib/mcp-handler";
import {
  type RateLimitScope,
  annotateTrackedRequestSpan,
  extractResponseMetricOptions,
  recordResponseMetric,
  stripResponseMetricHeaders,
} from "./metrics";
import { tokenExchangeCallback } from "./oauth";
import {
  bucketOAuthErrorCode,
  bucketOAuthErrorDescription,
  getOAuthErrorTelemetry,
} from "./oauth/telemetry";
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

const AUTH_PARAM_SEPARATOR = /,\s*(?=[A-Za-z_][A-Za-z0-9_-]*\s*=)/;
const AUTH_CHALLENGE = /^(\S+)(?:\s+(.+))?$/;
const RESOURCE_METADATA_PARAM = /^resource_metadata\s*=/i;

function replaceResourceMetadataParam(
  headerValue: string,
  resourceMetadataUrl: string,
): string {
  const match = headerValue.match(AUTH_CHALLENGE);
  if (!match) {
    return headerValue;
  }

  const [, scheme, params = ""] = match;
  const filteredParams = params
    .split(AUTH_PARAM_SEPARATOR)
    .map((param) => param.trim())
    .filter((param) => param && !RESOURCE_METADATA_PARAM.test(param));

  filteredParams.push(`resource_metadata="${resourceMetadataUrl}"`);
  return `${scheme} ${filteredParams.join(", ")}`;
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

  newResponse.headers.set(
    "WWW-Authenticate",
    replaceResourceMetadataParam(existing, prmUrl),
  );
  return newResponse;
}

async function finalizeResponse(
  request: Request,
  url: URL,
  response: Response,
  options?: {
    rateLimitScope?: RateLimitScope;
    responseReason?: "local_rate_limit";
  },
): Promise<Response> {
  const responseMetricOptions = extractResponseMetricOptions(response);
  const responseWithoutMetricHeaders = stripResponseMetricHeaders(response);
  const oauthErrorTelemetry =
    response.status >= 400 &&
    (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/oauth"))
      ? await getOAuthErrorTelemetry(request, responseWithoutMetricHeaders)
      : {};
  const finalized = isPublicMetadataEndpoint(url.pathname)
    ? addCorsHeaders(responseWithoutMetricHeaders)
    : stripCorsHeaders(responseWithoutMetricHeaders);

  const metricOptions = {
    ...responseMetricOptions,
    ...oauthErrorTelemetry,
    ...options,
  };

  annotateTrackedRequestSpan(request, url, finalized, metricOptions);
  recordResponseMetric(request, finalized, {
    ...metricOptions,
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
    const activeSpan = Sentry.getActiveSpan();
    activeSpan?.setAttribute("app.client.family", clientFamily);
    // Set utm_source early on /mcp requests so the attribute is present even
    // if the request is rejected before reaching mcp-handler.ts.
    if (url.pathname.startsWith("/mcp")) {
      const utmSource = resolveUtmSourceFromUrl(url);
      if (utmSource) {
        activeSpan?.setAttribute(UTM_SOURCE_ATTRIBUTE, utmSource);
      }
    }

    // Reject registrations with userinfo-spoofed redirect URIs before the
    // library stores the client (e.g. host@example.io).
    if (request.method === "POST" && url.pathname === "/oauth/register") {
      try {
        const body = (await request.clone().json()) as {
          redirect_uris?: unknown;
        };
        const redirectUris = Array.isArray(body.redirect_uris)
          ? body.redirect_uris
          : [];
        if (
          redirectUris.some(
            (uri) => typeof uri === "string" && redirectUriHasUserInfo(uri),
          )
        ) {
          return finalizeResponse(
            request,
            url,
            new Response(
              JSON.stringify({
                error: "invalid_redirect_uri",
                error_description:
                  "redirect_uris must not contain a userinfo component",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
      } catch {
        // Malformed body — let the library produce its own error.
      }
    }

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
      clientIdMetadataDocumentEnabled: true,
      tokenExchangeCallback: (options) =>
        tokenExchangeCallback(options, env, request, clientFamily),
      scopesSupported: Object.keys(SCOPES),
      // Expire grants after 30 days to prevent unbounded KV accumulation.
      // Sentry access tokens also have a 30-day lifetime, so re-auth is
      // required after this window regardless.
      refreshTokenTTL: 30 * 24 * 60 * 60,
      onError: ({ status, code, description }) => {
        logWarn(`OAuth error response: ${status} ${code} - ${description}`, {
          loggerScope: ["cloudflare", "oauth", "provider"],
          extra: {
            "http.response.status_code": status,
            "app.oauth.error": bucketOAuthErrorCode(code),
            "app.oauth.error_description":
              bucketOAuthErrorDescription(description),
            "app.client.family": clientFamily,
          },
        });
      },
    });

    const response = await oAuthProvider.fetch(request, env, ctx);

    if (
      request.method === "POST" &&
      url.pathname === "/oauth/register" &&
      response.ok
    ) {
      Sentry.metrics.count("app.oauth.register", 1, {
        attributes: { "app.client.family": clientFamily },
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
