/**
 * Main entry point for the Hono-based Sentry MCP server
 * 
 * This implementation uses:
 * - Hono for routing and middleware
 * - Cloudflare KV for OAuth storage
 * - @hono/mcp for MCP HTTP streaming
 * - Durable Objects for SSE (backward compatibility)
 */

import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { logger as honoLogger } from "hono/logger";

// Import our app and routes
import app from "./app";
import mcpRoutes from "./routes/mcp";
import sseRoutes from "./routes/sse";
import sentryOauth from "./routes/sentry-oauth";

// Import types and config
import type { Env } from "./types";
import getSentryConfig from "./sentry.config";
import { SCOPES } from "../constants";

// Required for Durable Objects (SSE support)
import SentryMCP from "./lib/mcp-transport";
export { SentryMCP };

// Create the main Hono app
const mainApp = new Hono<{ Bindings: Env }>();

// Apply global middleware
mainApp
  // Logging middleware (development)
  .use("*", honoLogger())
  // Set user IP address from headers for Sentry
  .use("*", async (c, next) => {
    const clientIP =
      c.req.header("X-Real-IP") ||
      c.req.header("CF-Connecting-IP") ||
      c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();

    if (clientIP) {
      Sentry.setUser({ ip_address: clientIP });
    }

    await next();
  })
  // Security headers
  .use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
    })
  )
  // CSRF protection
  .use(
    "*",
    csrf({
      origin: (origin, c) => {
        // No Origin header = not a CSRF attack
        if (!origin) return true;
        // Verify Origin matches request URL
        const requestUrl = new URL(c.req.url);
        return origin === requestUrl.origin;
      },
    })
  );

// CORS configuration for public endpoints
const PUBLIC_PATHS = [
  "/.well-known/*",
  "/robots.txt",
  "/llms.txt",
];

mainApp.use(
  "/.well-known/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

mainApp.use(
  "/robots.txt",
  cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
  })
);

mainApp.use(
  "/llms.txt",
  cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
  })
);

// Public metadata endpoints
mainApp
  .get("/robots.txt", (c) => {
    return c.text(["User-agent: *", "Allow: /$", "Disallow: /"].join("\n"));
  })
  .get("/llms.txt", (c) => {
    return c.text(
      [
        "# sentry-mcp",
        "",
        "This service implements the Model Context Protocol for interacting with Sentry (https://sentry.io/welcome/).",
        "",
        `The MCP's server address is: ${new URL("/mcp", c.req.url).href}`,
        "",
      ].join("\n")
    );
  })
  // OAuth discovery endpoints
  .get("/.well-known/oauth-authorization-server", async (c) => {
    const baseUrl = new URL(c.req.url).origin;
    return c.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      scopes_supported: Object.keys(SCOPES),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    });
  })
  .get("/.well-known/oauth-protected-resource", async (c) => {
    const baseUrl = new URL(c.req.url).origin;
    return c.json({
      resource: baseUrl,
      scopes_supported: Object.keys(SCOPES),
      bearer_methods_supported: ["header"],
    });
  });

// Mount route modules
mainApp
  .route("/oauth", sentryOauth)     // OAuth endpoints
  .route("/mcp", mcpRoutes)          // MCP HTTP streaming endpoints
  .route("/sse", sseRoutes)          // SSE endpoints (Durable Objects)
  .route("/", app);                  // All other app routes (chat, search, etc.)

// Error handling
mainApp.onError((err, c) => {
  // Log to Sentry
  Sentry.captureException(err);
  
  console.error("Unhandled error:", err);
  
  // Return appropriate error response
  if (err instanceof Response) {
    return err;
  }
  
  return c.json(
    {
      error: "internal_server_error",
      error_description: "An unexpected error occurred",
    },
    500
  );
});

// 404 handler
mainApp.notFound((c) => {
  return c.json(
    {
      error: "not_found",
      error_description: "The requested resource was not found",
    },
    404
  );
});

// Export with Sentry wrapper
export default Sentry.withSentry(
  getSentryConfig,
  mainApp
) satisfies ExportedHandler<Env>;