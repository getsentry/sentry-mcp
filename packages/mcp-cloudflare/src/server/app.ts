import { Hono, type MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
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

const csrfProtection = csrf({
  origin: (origin, c) => {
    if (!origin) {
      return true;
    }
    const requestUrl = new URL(c.req.url);
    return origin === requestUrl.origin;
  },
});

const browserFormCsrf: MiddlewareHandler = async (c, next) => {
  // Non-browser clients (including service-to-service requests) won't send the Sec-Fetch-Site
  // header, so we bypass CSRF enforcement for them to avoid false positives.
  if (!c.req.header("sec-fetch-site")) {
    return next();
  }
  return csrfProtection(c, next);
};

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
  .use("*", browserFormCsrf)
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
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  return c.text("Internal Server Error", 500);
});

export default app;
