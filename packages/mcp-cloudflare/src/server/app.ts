import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import * as Sentry from "@sentry/cloudflare";
import type { Env } from "./types";
import sentryOauth from "./oauth";
import chatOauth from "./routes/chat-oauth";
import chat from "./routes/chat";
import search from "./routes/search";
import metadata from "./routes/metadata";
import { logIssue } from "@sentry/mcp-server/telem/logging";
import { createRequestLogger } from "./logging";
import mcpRoutes from "./routes/mcp";
import { getClientIp } from "./utils/client-ip";

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
