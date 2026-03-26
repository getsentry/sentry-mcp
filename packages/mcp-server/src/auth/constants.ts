import { SCOPES } from "@sentry/mcp-core/scopes";

/**
 * Bundled OAuth client ID for sentry.io device code flow.
 * Override via SENTRY_CLIENT_ID environment variable.
 */
export const DEFAULT_SENTRY_CLIENT_ID =
  "0acbeba7d07d58076dd7dbde8cea2fed8ab525ce3713bda604988009ab35d765";

/** Device code request endpoint. */
export const DEVICE_CODE_ENDPOINT = "/oauth/device/code/";

/** Token exchange endpoint. */
export const TOKEN_ENDPOINT = "/oauth/token/";

/** OAuth scopes requested during device code flow (same as cloudflare OAuth). */
export const DEVICE_CODE_SCOPES = Object.keys(SCOPES).join(" ");

/** Interval increment on slow_down response (RFC 8628). */
export const SLOW_DOWN_INCREMENT_SEC = 5;

/** Device code flow is only supported for sentry.io. */
export function isSentryIo(host: string): boolean {
  return host === "sentry.io";
}
