import * as Sentry from "@sentry/cloudflare";
import type { Env } from "./types.js";
import getSentryConfig from "./sentry.config.js";
import { getClientIp } from "./utils/client-ip.js";
import { logIssue } from "@sentry/mcp-core/telem/logging";

// Public metadata endpoints that should be accessible from any origin
const PUBLIC_METADATA_PATHS = [
  "/.well-known/", // OAuth discovery endpoints
  "/robots.txt", // Search engine directives
  "/llms.txt", // LLM/AI agent directives
  "/.mcp/", // MCP metadata endpoints
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

// Routes that should be rate limited
const RATE_LIMITED_PATHS = ["/mcp", "/oauth"];

const shouldRateLimit = (pathname: string): boolean => {
  return RATE_LIMITED_PATHS.some((path) => pathname.startsWith(path));
};

/**
 * Router Worker
 *
 * Single entry point for all traffic. Handles cross-cutting concerns
 * before dispatching to backend services via service bindings.
 *
 * Responsibilities:
 * - Rate limiting on /mcp and /oauth routes
 * - CORS headers for public endpoints
 * - Route dispatching to appropriate backend service
 * - Observability entry point
 */
const routerHandler = {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight for public metadata endpoints
    if (request.method === "OPTIONS") {
      if (isPublicMetadataEndpoint(path)) {
        return addCorsHeaders(new Response(null, { status: 204 }));
      }
    }

    // Apply rate limiting to MCP and OAuth routes
    if (shouldRateLimit(path) && env.MCP_RATE_LIMITER) {
      const clientIP = getClientIp(request);

      // In local development or when IP can't be extracted, skip rate limiting
      if (clientIP) {
        try {
          const { success } = await env.MCP_RATE_LIMITER.limit({
            key: `router:${clientIP}`,
          });

          if (!success) {
            return new Response(
              "Rate limit exceeded. Please wait before trying again.",
              { status: 429, headers: { "Retry-After": "60" } },
            );
          }
        } catch (error) {
          // Log rate limiter error but don't block the request
          logIssue(error, {
            loggerScope: ["router", "rate-limiter"],
          });
        }
      }
    }

    // Determine target service based on path
    const service = getTargetService(path, env);

    try {
      // Forward request to target service
      const response = await service.fetch(request);

      // Add CORS headers to public metadata endpoints
      if (isPublicMetadataEndpoint(path)) {
        return addCorsHeaders(response);
      }

      return response;
    } catch (error) {
      logIssue(error, {
        loggerScope: ["router", "service-binding"],
        extra: {
          targetPath: path,
        },
      });
      return new Response("Service temporarily unavailable", { status: 503 });
    }
  },
};

/**
 * Route requests to the appropriate backend service
 *
 * Server worker handles:
 * - /mcp/* - MCP protocol
 * - /.mcp/* - MCP metadata
 * - /oauth/* - OAuth authorization flows
 * - /.well-known/* - OAuth discovery
 * - /robots.txt, /llms.txt - SEO/LLM directives
 *
 * Web worker handles:
 * - /api/* - Chat, search, auth APIs
 * - /* - Static assets and SPA routes
 */
function getTargetService(path: string, env: Env): Fetcher {
  // MCP protocol routes
  if (path.startsWith("/mcp")) {
    return env.SERVER_SERVICE;
  }

  // MCP metadata routes
  if (path.startsWith("/.mcp")) {
    return env.SERVER_SERVICE;
  }

  // OAuth routes (now handled by Server worker)
  if (path.startsWith("/oauth")) {
    return env.SERVER_SERVICE;
  }

  // Well-known routes (OAuth discovery, handled by Server worker)
  if (path.startsWith("/.well-known")) {
    return env.SERVER_SERVICE;
  }

  // SEO/LLM routes
  if (path === "/robots.txt" || path === "/llms.txt") {
    return env.SERVER_SERVICE;
  }

  // API routes (chat, search, auth, metadata)
  if (path.startsWith("/api/")) {
    return env.WEB_SERVICE;
  }

  // Default: static assets and SPA routes
  return env.WEB_SERVICE;
}

export default Sentry.withSentry(
  getSentryConfig,
  routerHandler,
) satisfies ExportedHandler<Env>;
