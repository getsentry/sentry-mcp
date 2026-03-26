import type { PartiallyResolvedConfig, ResolvedConfig } from "../cli/types";
import { isSentryIo } from "./constants";
import { authenticate, DeviceCodeError } from "./device-code-flow";
import { readCachedToken, writeCachedToken } from "./token-cache";
import { toCachedToken } from "./types";

/**
 * Resolves the access token for the session.
 *
 * If an access token is already provided, returns immediately.
 * If the host is sentry.io, attempts to use a cached token or
 * initiates the device code flow.
 * For non-sentry.io hosts, throws an error requiring --access-token.
 */
export async function resolveAccessToken(
  partial: PartiallyResolvedConfig,
): Promise<ResolvedConfig> {
  if (partial.accessToken) {
    return { ...partial, accessToken: partial.accessToken };
  }

  if (!isSentryIo(partial.sentryHost)) {
    throw new Error(
      "Error: No access token was provided. Device code authentication is only supported for sentry.io.\n" +
        "Pass one with `--access-token` or via `SENTRY_ACCESS_TOKEN`.",
    );
  }

  const { clientId, sentryHost } = partial;

  // Try cached token first
  try {
    const cached = await readCachedToken(sentryHost, clientId);
    if (cached) {
      process.stderr.write(
        `Using cached authentication for ${cached.user_email}\n`,
      );
      return { ...partial, accessToken: cached.access_token };
    }
  } catch {
    // Cache read failure is non-fatal — fall through to device code flow
  }

  // Run device code flow
  try {
    const tokenResponse = await authenticate({ clientId, host: sentryHost });

    try {
      await writeCachedToken(
        toCachedToken(tokenResponse, sentryHost, clientId),
      );
    } catch {
      process.stderr.write("Warning: Could not cache authentication token.\n");
    }

    return { ...partial, accessToken: tokenResponse.access_token };
  } catch (err) {
    if (err instanceof DeviceCodeError) {
      throw new Error(err.message);
    }
    throw new Error(
      `Device code authentication failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
