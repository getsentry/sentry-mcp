import { Hono, type Context } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import * as Sentry from "@sentry/cloudflare";
import type { Env } from "./types";
import sentryOauth from "./oauth";
import chatOauth from "./routes/chat-oauth";
import chat from "./routes/chat";
import search from "./routes/search";
import metadata from "./routes/metadata";
import { logIssue } from "@sentry/mcp-core/telem/logging";
import { createRequestLogger } from "./logging";
import mcpRoutes from "./routes/mcp";
import { getClientIp } from "./utils/client-ip";

// RFC 9728: OAuth 2.0 Protected Resource Metadata handler
function handleOAuthProtectedResourceMetadata(c: Context) {
  const requestUrl = new URL(c.req.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  const resourcePath = requestUrl.pathname.replace(
    "/.well-known/oauth-protected-resource",
    "",
  );
  return c.json({
    resource: `${baseUrl}${resourcePath}`,
    authorization_servers: [baseUrl],
  });
}

const app = new Hono<{
  Bindings: Env;
}>()
  .use("*", createRequestLogger())
  // Set user IP address for Sentry (optional in local dev)
  .use("*", async (c, next) => {
    const clientIP = getClientIp(c.req.raw);

    if (clientIP) {
      Sentry.setUser({ ip_address: clientIP });
    }
    // In local development, IP extraction may fail - this is expected and safe to ignore
    // as it's only used for Sentry telemetry context

    await next();
  })
  // Apply security middleware globally
  .use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
    }),
  )
  .use(
    "*",
    csrf({
      origin: (origin, c) => {
        if (!origin) {
          return true;
        }
        const requestUrl = new URL(c.req.url);
        return origin === requestUrl.origin;
      },
    }),
  )
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
      ].join("\n"),
    );
  })
  .get("/mcp.json", (c) => {
    const requestUrl = new URL(c.req.url);
    return c.json({
      name: "Sentry",
      description:
        "Connect your Sentry account to search, analyze, and manage errors and performance issues across your applications.",
      icon: `${requestUrl.protocol}//${requestUrl.host}/favicon.ico`,
      endpoint: `${requestUrl.protocol}//${requestUrl.host}/mcp`,
    });
  })
  // RFC 9728: OAuth 2.0 Protected Resource Metadata
  // ChatGPT and other clients query this to discover the authorization server
  // Handles both /mcp and /mcp/* paths (e.g., /mcp/sentry/mcp-server)
  .get(
    "/.well-known/oauth-protected-resource/mcp",
    handleOAuthProtectedResourceMetadata,
  )
  .get(
    "/.well-known/oauth-protected-resource/mcp/*",
    handleOAuthProtectedResourceMetadata,
  )
  .route("/oauth", sentryOauth)
  .route("/api/auth", chatOauth)
  .route("/api/chat", chat)
  .route("/api/search", search)
  .route("/api/metadata", metadata)
  .route("/.mcp", mcpRoutes)
  .get("/sse", (c) => {
    return c.json(
      {
        error: "SSE transport has been removed",
        message:
          "The SSE transport endpoint is no longer supported. Please use the HTTP transport at /mcp instead.",
        migrationGuide: "https://mcp.sentry.dev",
      },
      410,
    );
  });

// TODO: propagate the error as sentry isnt injecting into hono
app.onError((err, c) => {
  logIssue(err);
  return c.text("Internal Server Error", 500);
});

export default app;
