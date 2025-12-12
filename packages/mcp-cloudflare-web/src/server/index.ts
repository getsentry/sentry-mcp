import * as Sentry from "@sentry/cloudflare";
import type { Env } from "./types.js";
import getSentryConfig from "./sentry.config.js";
import app from "./app.js";

/**
 * Web Worker
 *
 * Serves the React SPA and handles chat-related APIs.
 * - Static assets via ASSETS binding (automatic fallback)
 * - /api/chat - AI chat using OpenAI + MCP tools
 * - /api/search - AutoRAG documentation search
 * - /api/auth/* - OAuth client for chat authentication
 * - /api/metadata - MCP server info for chat
 *
 * Note: In multi-worker architecture, the router worker forwards requests here.
 * Static assets are served by Cloudflare's built-in asset handling.
 */
const webHandler = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle API routes via Hono app
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }

    // For non-API routes, let the ASSETS binding handle static files
    // The wrangler.jsonc is configured with:
    // - "not_found_handling": "single-page-application"
    // This means unknown paths return index.html for client-side routing
    return env.ASSETS.fetch(request);
  },
};

export default Sentry.withSentry(
  getSentryConfig,
  webHandler,
) satisfies ExportedHandler<Env>;
