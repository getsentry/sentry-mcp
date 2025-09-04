import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import * as Sentry from "@sentry/cloudflare";
import type { Env } from "./types";
import sentryOauth from "./routes/sentry-oauth";
import chatOauth from "./routes/chat-oauth";
import chat from "./routes/chat";
import search from "./routes/search";
import metadata from "./routes/metadata";
import { logError } from "@sentry/mcp-server/logging";

const app = new Hono<{
  Bindings: Env;
}>()
  // Set user IP address from X-Real-IP header for Sentry
  .use("*", async (c, next) => {
    // Extract client IP from headers in order of preference
    const clientIP =
      c.req.header("X-Real-IP") ||
      c.req.header("CF-Connecting-IP") ||
      c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();

    if (clientIP) {
      // Set the user context with the correct IP address
      Sentry.setUser({ ip_address: clientIP });
    }

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
        // If no Origin header is present, this cannot be a CSRF attack
        // (CSRF requires a cross-origin request which always has an Origin header)
        if (!origin) {
          return true;
        }
        // If Origin is present, verify it matches the request URL's origin
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
  .route("/api/metadata", metadata);

// TODO: propagate the error as sentry isnt injecting into hono
app.onError((err, c) => {
  logError(err);
  return c.text("Internal Server Error", 500);
});

export default app;
