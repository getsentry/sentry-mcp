import { SCOPES } from "@sentry/mcp-core/scopes";
import { isSentryHost } from "@sentry/mcp-core/utils/url-utils";

/** Override via SENTRY_CLIENT_ID environment variable. */
export const DEFAULT_SENTRY_CLIENT_ID =
  "0acbeba7d07d58076dd7dbde8cea2fed8ab525ce3713bda604988009ab35d765";

export const DEVICE_CODE_ENDPOINT = "/oauth/device/code/";
export const TOKEN_ENDPOINT = "/oauth/token/";
export const DEVICE_CODE_SCOPES = Object.keys(SCOPES).join(" ");

/** Interval increment on slow_down response (RFC 8628). */
export const SLOW_DOWN_INCREMENT_SEC = 5;

/**
 * Whether device code auth is available for this host.
 * Supports sentry.io and regional subdomains (us.sentry.io, eu.sentry.io).
 */
export { isSentryHost as isSentryIo };

/**
 * OAuth endpoints live on sentry.io regardless of regional host.
 * Always use this as the host for device code and token requests.
 */
export const OAUTH_HOST = "sentry.io";
