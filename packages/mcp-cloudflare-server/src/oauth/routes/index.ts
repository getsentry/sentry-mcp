import { Hono } from "hono";
import type { Env } from "../../types.js";
import authorizeApp from "./authorize.js";
import callbackApp from "./callback.js";

// Compose and export the main OAuth Hono app
export default new Hono<{ Bindings: Env }>()
  .route("/authorize", authorizeApp)
  .route("/callback", callbackApp);
