import { Hono } from "hono";
import type { Env } from "./types";
import sentryOauth from "./routes/sentry-oauth";
import chatOauth from "./routes/chat-oauth";
import chat from "./routes/chat";
import search from "./routes/search";
import { logError } from "@sentry/mcp-server/logging";

const app = new Hono<{
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
  .route("/api/search", search);

// TODO: propagate the error as sentry isnt injecting into hono
app.onError((err, c) => {
  logError(err);
  return c.text("Internal Server Error", 500);
});

export default app;
