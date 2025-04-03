import { Hono } from "hono";
import authHandler from "./authHandler";
import webHandler from "./web/handler";

export default new Hono<{
  Bindings: Env & { SENTRY_DSN: string };
}>()
  .get("/robots.txt", (c) => {
    return c.text("User-agent: *\nDisallow: /");
  })
  .route("/", webHandler)
  .route("/", authHandler);
