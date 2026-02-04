import { Hono } from "hono";
import type { Env } from "../../types";
import authorizeApp from "./authorize";
import callbackApp from "./callback";
import registerApp from "./register";
import tokenApp from "./token";

// Compose and export the main OAuth Hono app
export default new Hono<{ Bindings: Env }>()
  .route("/authorize", authorizeApp)
  .route("/callback", callbackApp)
  .route("/token", tokenApp)
  .route("/register", registerApp);
