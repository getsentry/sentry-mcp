import { Hono } from "hono";
import { withSentry } from "@sentry/cloudflare";
import authHandler from "./auth-handler";
import { Env } from "./types";

const app = new Hono<{
  Bindings: Env;
}>()
  .get("/robots.txt", (c) => {
    return c.text("User-agent: *\nDisallow: /");
  })
  .get("/", async (c) => {
    return c.text("https://github.com/getsentry/sentry-mcp");
  })
  .route("/", authHandler);

export default withSentry(
  (env) => ({
    // @ts-ignore
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1,
  }),
  app
);
