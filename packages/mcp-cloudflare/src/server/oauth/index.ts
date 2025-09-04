import { Hono } from "hono";
import type { Env } from "../types";
import authorizeApp from "./authorize";
import callbackApp from "./callback";

// Re-export helper functions and constants for external use
export { tokenExchangeCallback } from "./helpers";
export {
  SENTRY_AUTH_URL,
  SENTRY_TOKEN_URL,
  TokenResponseSchema,
} from "./constants";
export {
  getUpstreamAuthorizeUrl,
  exchangeCodeForAccessToken,
  refreshAccessToken,
} from "./helpers";

// Compose and export the main OAuth Hono app
export default new Hono<{ Bindings: Env }>()
  .route("/authorize", authorizeApp)
  .route("/callback", callbackApp);
