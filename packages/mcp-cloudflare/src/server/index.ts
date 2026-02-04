import * as Sentry from "@sentry/cloudflare";
import type { Context } from "hono";
import { Hono } from "hono";
import app from "./app";
import sentryMcpHandler from "./lib/mcp-handler";
import {
  bearerAuth,
  createKVStorage,
  createOAuthHelpers,
  metadataRoute,
} from "./oauth";
import getSentryConfig from "./sentry.config";
import type { Env, WorkerProps } from "./types";
import { getClientIp } from "./utils/client-ip";
import { checkRateLimit } from "./utils/rate-limiter";

// Import to ensure module augmentation for ContextVariableMap is applied
import "./oauth/middleware/auth";

// Public metadata endpoints that should be accessible from any origin
const PUBLIC_METADATA_PATHS = [
  "/.well-known/", // OAuth discovery endpoints
  "/robots.txt", // Search engine directives
  "/llms.txt", // LLM/AI agent directives
  "/mcp.json", // MCP server metadata
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

/**
 * Main Hono application combining all routes.
 *
 * This replaces the workers-oauth-provider with our own OAuth implementation.
 * The middleware chain:
 * 1. Sets up OAuth storage and helpers in context
 * 2. Handles rate limiting
 * 3. Routes to appropriate handlers
 */
const mainApp = new Hono<{ Bindings: Env }>();

// Middleware to set up OAuth storage and helpers
mainApp.use("*", async (c, next) => {
  const storage = createKVStorage(c.env.OAUTH_KV);
  const helpers = createOAuthHelpers(storage);

  // Set storage in context for routes
  c.set("oauthStorage", storage);

  // Set helpers on env for backward compatibility with existing routes
  // This matches the OAUTH_PROVIDER pattern used by authorize.ts and callback.ts
  c.env.OAUTH_PROVIDER = helpers;

  await next();
});

// Handle CORS preflight for public metadata endpoints
mainApp.options("*", async (c) => {
  const url = new URL(c.req.url);
  if (isPublicMetadataEndpoint(url.pathname)) {
    return addCorsHeaders(new Response(null, { status: 204 }));
  }
  return c.text("Method Not Allowed", 405);
});

// Rate limiting for MCP and OAuth routes
mainApp.use("/mcp/*", async (c, next) => {
  const clientIP = getClientIp(c.req.raw);
  if (clientIP) {
    const rateLimitResult = await checkRateLimit(
      clientIP,
      c.env.MCP_RATE_LIMITER,
      {
        keyPrefix: "mcp",
        errorMessage: "Rate limit exceeded. Please wait before trying again.",
      },
    );
    if (!rateLimitResult.allowed) {
      return c.text(rateLimitResult.errorMessage!, 429);
    }
  }
  await next();
});

mainApp.use("/oauth/*", async (c, next) => {
  const clientIP = getClientIp(c.req.raw);
  if (clientIP) {
    const rateLimitResult = await checkRateLimit(
      clientIP,
      c.env.MCP_RATE_LIMITER,
      {
        keyPrefix: "oauth",
        errorMessage: "Rate limit exceeded. Please wait before trying again.",
      },
    );
    if (!rateLimitResult.allowed) {
      return c.text(rateLimitResult.errorMessage!, 429);
    }
  }
  await next();
});

// OAuth Authorization Server Metadata (RFC 8414)
// Must be before the general .well-known handler in app.ts
mainApp.route("/.well-known/oauth-authorization-server", metadataRoute);

// MCP API routes - require Bearer token authentication
mainApp.use("/mcp/*", bearerAuth());

// MCP handler - after auth middleware validates token and sets props
const handleMcpRequest = async (c: Context<{ Bindings: Env }>) => {
  const auth = c.get("auth");
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const ctx = {
    props: auth.props,
    waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
    passThroughOnException: c.executionCtx.passThroughOnException?.bind(
      c.executionCtx,
    ),
  };

  return sentryMcpHandler.fetch(
    c.req.raw,
    c.env,
    ctx as ExecutionContext & { props: WorkerProps },
  );
};

mainApp.all("/mcp", handleMcpRequest);
mainApp.all("/mcp/*", handleMcpRequest);

// Mount the main Hono app (includes OAuth routes, chat, search, etc.)
mainApp.route("/", app);

// Wrap with CORS headers for public metadata endpoints
const wrappedApp = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url);
    const response = await mainApp.fetch(request, env, ctx);

    // Add CORS headers to public metadata endpoints
    if (isPublicMetadataEndpoint(url.pathname)) {
      return addCorsHeaders(response);
    }

    return response;
  },
};

export default Sentry.withSentry(
  getSentryConfig,
  wrappedApp,
) satisfies ExportedHandler<Env>;
