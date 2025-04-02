import { Hono } from "hono";
import { withSentry } from "@sentry/cloudflare";
import authHandler from "./routes/auth";
import homeHandler from "./routes/home";

const app = new Hono<{
  Bindings: Env & { SENTRY_DSN: string };
}>()
  .get("/robots.txt", (c) => {
    return c.text("User-agent: *\nDisallow: /");
  })
  .route("/", authHandler)
  .route("/", homeHandler);

export default withSentry(
  (env) => ({
    // @ts-ignore
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1,
  }),
  app
);
