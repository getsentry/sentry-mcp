/**
 * OAuth Authentication
 *
 * Implements RFC 8628 Device Authorization Grant for Sentry OAuth.
 * https://datatracker.ietf.org/doc/html/rfc8628
 */

import type { TokenResponse } from "../types/index.js";
import {
  DeviceCodeResponseSchema,
  TokenErrorResponseSchema,
  TokenResponseSchema,
} from "../types/index.js";
import { setAuthToken } from "./config.js";
import { ApiError, ConfigError, DeviceFlowError } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// Sentry instance URL (supports self-hosted via env override)
const SENTRY_URL = process.env.SENTRY_URL ?? "https://sentry.io";

/**
 * OAuth client ID
 *
 * Build-time: Injected via Bun.build({ define: { SENTRY_CLIENT_ID: "..." } })
 * Runtime: Can be overridden via SENTRY_CLIENT_ID env var (for self-hosted)
 *
 * @see packages/cli/script/build.ts
 */
declare const SENTRY_CLIENT_ID_BUILD: string | undefined;
const SENTRY_CLIENT_ID =
  process.env.SENTRY_CLIENT_ID ??
  (typeof SENTRY_CLIENT_ID_BUILD !== "undefined" ? SENTRY_CLIENT_ID_BUILD : "");

// OAuth scopes requested for the CLI
const SCOPES = [
  "project:read",
  "project:write",
  "org:read",
  "event:read",
  "event:write",
  "member:read",
  "team:read",
].join(" ");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type DeviceFlowCallbacks = {
  onUserCode: (
    userCode: string,
    verificationUri: string,
    verificationUriComplete: string
  ) => void | Promise<void>;
  onPolling?: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Device Flow Implementation (RFC 8628)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request a device code from Sentry's device authorization endpoint
 */
async function requestDeviceCode() {
  if (!SENTRY_CLIENT_ID) {
    throw new ConfigError(
      "SENTRY_CLIENT_ID is required for authentication",
      "Set SENTRY_CLIENT_ID environment variable or use a pre-built binary"
    );
  }

  let response: Response;

  try {
    response = await fetch(`${SENTRY_URL}/oauth/device/code/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: SENTRY_CLIENT_ID,
        scope: SCOPES,
      }),
    });
  } catch (error) {
    const isConnectionError =
      error instanceof Error &&
      (error.message.includes("ECONNREFUSED") ||
        error.message.includes("fetch failed") ||
        error.message.includes("network"));

    if (isConnectionError) {
      throw new ApiError(
        `Cannot connect to Sentry at ${SENTRY_URL}`,
        0,
        "Check your network connection and SENTRY_URL configuration"
      );
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new ApiError(
      "Failed to initiate device flow",
      response.status,
      errorText,
      "/oauth/device/code/"
    );
  }

  const data = await response.json();

  const result = DeviceCodeResponseSchema.safeParse(data);
  if (!result.success) {
    throw new ApiError(
      "Invalid response from device authorization endpoint",
      response.status,
      result.error.errors.map((e) => e.message).join(", "),
      "/oauth/device/code/"
    );
  }

  return result.data;
}

/**
 * Poll Sentry's token endpoint for the access token
 */
async function pollForToken(deviceCode: string): Promise<TokenResponse> {
  const response = await fetch(`${SENTRY_URL}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SENTRY_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  const data = await response.json();

  // Try to parse as success response first
  const tokenResult = TokenResponseSchema.safeParse(data);
  if (tokenResult.success) {
    return tokenResult.data;
  }

  // Try to parse as error response
  const errorResult = TokenErrorResponseSchema.safeParse(data);
  if (errorResult.success) {
    throw new DeviceFlowError(
      errorResult.data.error,
      errorResult.data.error_description
    );
  }

  // If neither schema matches, throw a generic error
  throw new ApiError(
    "Unexpected response from token endpoint",
    response.status,
    JSON.stringify(data),
    "/oauth/token/"
  );
}

type PollResult =
  | { status: "success"; token: TokenResponse }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "error"; message: string };

/**
 * Handle a single poll attempt, returning a result object
 */
async function attemptPoll(deviceCode: string): Promise<PollResult> {
  try {
    const token = await pollForToken(deviceCode);
    return { status: "success", token };
  } catch (error) {
    if (!(error instanceof DeviceFlowError)) {
      throw error;
    }

    switch (error.code) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "slow_down" };
      case "expired_token":
        return {
          status: "error",
          message: "Device code expired. Please run 'sentry auth login' again.",
        };
      case "access_denied":
        return {
          status: "error",
          message: "Authorization was denied. Please try again.",
        };
      default:
        return { status: "error", message: error.message };
    }
  }
}

/**
 * Perform the Device Flow for OAuth authentication (RFC 8628).
 *
 * Initiates the device authorization flow by requesting a device code,
 * then polls for the access token until the user completes authorization.
 *
 * @param callbacks - Callbacks for UI updates during the flow
 * @param timeout - Maximum time to wait for authorization in ms (default: 10 minutes)
 * @returns The token response containing access_token and metadata
 * @throws {ConfigError} When SENTRY_CLIENT_ID is not configured
 * @throws {ApiError} When unable to connect to Sentry or API returns an error
 * @throws {DeviceFlowError} When authorization fails, is denied, or times out
 */
export async function performDeviceFlow(
  callbacks: DeviceFlowCallbacks,
  timeout = 600_000 // 10 minutes default (matches Sentry's expires_in)
): Promise<TokenResponse> {
  // Step 1: Request device code
  const {
    device_code,
    user_code,
    verification_uri,
    verification_uri_complete,
    interval,
    expires_in,
  } = await requestDeviceCode();

  // Notify caller of the user code
  await callbacks.onUserCode(
    user_code,
    verification_uri,
    verification_uri_complete ?? `${verification_uri}?user_code=${user_code}`
  );

  // Calculate absolute timeout
  const timeoutAt = Date.now() + Math.min(timeout, expires_in * 1000);

  // Track polling interval (may increase on slow_down)
  let pollInterval = interval;

  // Step 2: Poll for token
  while (Date.now() < timeoutAt) {
    await sleep(pollInterval * 1000);
    callbacks.onPolling?.();

    const result = await attemptPoll(device_code);

    switch (result.status) {
      case "success":
        return result.token;
      case "pending":
        continue;
      case "slow_down":
        pollInterval += 5;
        continue;
      case "error":
        throw new DeviceFlowError("authorization_failed", result.message);
      default:
        throw new DeviceFlowError("unexpected_error", "Unexpected poll result");
    }
  }

  throw new DeviceFlowError(
    "expired_token",
    "Authentication timed out. Please try again."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete the OAuth flow by storing the token in the config file.
 *
 * @param tokenResponse - The token response from performDeviceFlow
 */
export async function completeOAuthFlow(
  tokenResponse: TokenResponse
): Promise<void> {
  await setAuthToken(
    tokenResponse.access_token,
    tokenResponse.expires_in,
    tokenResponse.refresh_token
  );
}

/**
 * Store an API token directly (alternative to OAuth device flow).
 *
 * Use this for users who have an existing API token from Sentry settings.
 *
 * @param token - The API token to store
 */
export async function setApiToken(token: string): Promise<void> {
  await setAuthToken(token);
}
