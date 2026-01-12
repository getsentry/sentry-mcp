/**
 * OAuth Authentication
 *
 * Implements Device Flow for Sentry OAuth via proxy server.
 * No client secret needed on the CLI side.
 */

import type { TokenResponse } from "../types/index.js";
import { setAuthToken } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// OAuth proxy server URL - handles the actual OAuth flow with Sentry
const OAUTH_PROXY_URL =
  process.env.SENTRY_OAUTH_PROXY_URL ?? "https://sry-oauth.vercel.app";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

type DeviceTokenResponse =
  | TokenResponse
  | { error: string; error_description?: string };

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
// Device Flow Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request a device code from the OAuth proxy
 */
async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  let response: Response;

  try {
    response = await fetch(`${OAUTH_PROXY_URL}/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const isConnectionError =
      error instanceof Error &&
      (error.message.includes("ECONNREFUSED") ||
        error.message.includes("fetch failed") ||
        error.message.includes("network"));

    if (isConnectionError) {
      throw new Error(`Cannot connect to OAuth proxy at ${OAUTH_PROXY_URL}`);
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
 * Poll for the access token
 */
async function pollForToken(deviceCode: string): Promise<TokenResponse> {
  const response = await fetch(`${OAUTH_PROXY_URL}/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
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
  constructor(
    public readonly code: string,
    description?: string
  ) {
    super(description ?? code);
    this.name = "DeviceFlowError";
  }
}

/**
 * Perform the Device Flow for OAuth authentication
 *
 * @param callbacks - Callbacks for UI updates
 * @param timeout - Maximum time to wait for authorization (ms)
 */
export async function performDeviceFlow(
  callbacks: DeviceFlowCallbacks,
  timeout = 900_000 // 15 minutes default
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
    verification_uri_complete
  );

  // Calculate absolute timeout
  const timeoutAt = Date.now() + Math.min(timeout, expires_in * 1000);

  // Step 2: Poll for token
  while (Date.now() < timeoutAt) {
    await sleep(interval * 1000);

    callbacks.onPolling?.();

    try {
      const token = await pollForToken(device_code);
      return token;
    } catch (error) {
      if (error instanceof DeviceFlowError) {
        // Continue polling if authorization is pending
        if (error.code === "authorization_pending") {
          continue;
        }

        // Slow down if rate limited
        if (error.code === "slow_down") {
          await sleep(5000);
          continue;
        }

        // Token expired
        if (error.code === "expired_token") {
          throw new Error(
            "Device code expired. Please run 'sentry auth login' again."
          );
        }

        // Other errors are fatal
        throw error;
      }

      throw error;
    }
  }

  throw new Error("Authentication timed out. Please try again.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a URL in the user's default browser
 */
export async function openBrowser(url: string): Promise<void> {
  const { platform } = process;
  const { spawn } = await import("node:child_process");

  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  return new Promise((resolve) => {
    const proc = spawn(command, args, { detached: true, stdio: "ignore" });
    proc.unref();
    setTimeout(resolve, 500);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete the OAuth flow and store the token
 */
export function completeOAuthFlow(tokenResponse: TokenResponse): void {
  setAuthToken(
    tokenResponse.access_token,
    tokenResponse.expires_in,
    tokenResponse.refresh_token
  );
}

/**
 * Alternative: Token-based auth (for users who have an API token)
 */
export function setApiToken(token: string): void {
  setAuthToken(token);
}
