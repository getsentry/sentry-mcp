import { Hono } from "hono";

export type Env = {
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

// Route SPA paths to static assets
app.get("/docs/*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/docs", (c) => c.env.ASSETS.fetch(c.req.raw));

export default { fetch: app.fetch };
