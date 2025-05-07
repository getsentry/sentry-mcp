import { Hono } from "hono";
import type { Env } from "./types";
import sentryOauth from "./routes/sentry-oauth";

export default new Hono<{
  Bindings: Env;
}>()
  .get("/robots.txt", (c) => {
    return c.text(["User-agent: *", "Allow: /$", "Disallow: /"].join("\n"));
  })
  .get("/llms.txt", (c) => {
    return c.text(
      [
        "# sentry-mcp",
        "",
        "This service provides a Model Context Provider for interacting with Sentry's API (https://sentry.io).",
        "",
        `The MCP's server address is: ${new URL("/sse", c.req.url).href}`,
        "",
      ].join("\n"),
    );
  })
  .route("/oauth", sentryOauth);
