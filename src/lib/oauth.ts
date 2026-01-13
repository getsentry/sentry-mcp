/**
 * OAuth Authentication
 *
 * Implements RFC 8628 Device Authorization Grant for Sentry OAuth.
 * https://datatracker.ietf.org/doc/html/rfc8628
 */

import type {
  DeviceCodeResponse,
  TokenErrorResponse,
  TokenResponse,
} from "../types/index.js";
import { setAuthToken } from "./config.js";

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

type DeviceTokenResponse = TokenResponse | TokenErrorResponse;

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

function isTokenResponse(
  response: DeviceTokenResponse
): response is TokenResponse {
  return "access_token" in response;
}

// ─────────────────────────────────────────────────────────────────────────────
// Device Flow Implementation (RFC 8628)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request a device code from Sentry's device authorization endpoint
 */
async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  if (!SENTRY_CLIENT_ID) {
    throw new Error(
      "SENTRY_CLIENT_ID environment variable is required for authentication"
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
      throw new Error(`Cannot connect to Sentry at ${SENTRY_URL}`);
    }
    throw error;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to initiate device flow: ${error}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
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

  const data = (await response.json()) as DeviceTokenResponse;

  if (isTokenResponse(data)) {
    return data;
  }

  // Return the error response to be handled by the caller
  throw new DeviceFlowError(data.error, data.error_description);
}

/**
 * Custom error class for device flow errors
 */
class DeviceFlowError extends Error {
  readonly code: string;

  constructor(code: string, description?: string) {
    super(description ?? code);
    this.name = "DeviceFlowError";
    this.code = code;
  }
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
 * Perform the Device Flow for OAuth authentication (RFC 8628)
 *
 * @param callbacks - Callbacks for UI updates
 * @param timeout - Maximum time to wait for authorization (ms)
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
        throw new Error(result.message);
      default:
        throw new Error("Unexpected poll result");
    }
  }

  throw new Error("Authentication timed out. Please try again.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete the OAuth flow and store the token
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
 * Alternative: Token-based auth (for users who have an API token)
 */
export async function setApiToken(token: string): Promise<void> {
  await setAuthToken(token);
}
