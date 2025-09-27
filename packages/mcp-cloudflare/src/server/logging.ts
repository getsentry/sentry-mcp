import type { MiddlewareHandler } from "hono";
import { logInfo } from "@sentry/mcp-server/logging";

/**
 * Hono middleware that logs every request once the response is ready.
 */
export function createRequestLogger(
  loggerScope: readonly string[] = ["cloudflare", "http"],
): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();

    const url = new URL(c.req.url);
    logInfo(`${c.req.method} ${url.pathname}`, {
      loggerScope,
      extra: {
        status: c.res.status,
        duration_ms: Date.now() - start,
      },
    });
  };
}
