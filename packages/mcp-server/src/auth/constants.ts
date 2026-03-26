import { SCOPES } from "@sentry/mcp-core/scopes";

/** Override via SENTRY_CLIENT_ID environment variable. */
export const DEFAULT_SENTRY_CLIENT_ID =
  "0acbeba7d07d58076dd7dbde8cea2fed8ab525ce3713bda604988009ab35d765";

export const DEVICE_CODE_ENDPOINT = "/oauth/device/code/";
export const TOKEN_ENDPOINT = "/oauth/token/";
export const DEVICE_CODE_SCOPES = Object.keys(SCOPES).join(" ");

/** Interval increment on slow_down response (RFC 8628). */
export const SLOW_DOWN_INCREMENT_SEC = 5;

export function isSentryIo(host: string): boolean {
  return host === "sentry.io";
}
