import { Hono } from "hono";
import type { Env } from "../../types";
import authorizeApp from "./authorize";
import callbackApp from "./callback";

// Compose and export the main OAuth Hono app
export default new Hono<{ Bindings: Env }>()
  .route("/authorize", authorizeApp)
  .route("/callback", callbackApp);
