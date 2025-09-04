import type {
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import type { z } from "zod";
import { logError } from "@sentry/mcp-server/logging";
import { TokenResponseSchema, SENTRY_TOKEN_URL } from "./constants";
import type { WorkerProps } from "../types";

/**
 * Constructs an authorization URL for Sentry.
 */
export function getUpstreamAuthorizeUrl({
  upstream_url,
  client_id,
  scope,
  redirect_uri,
  state,
}: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}) {
  const upstream = new URL(upstream_url);
  upstream.searchParams.set("client_id", client_id);
  upstream.searchParams.set("redirect_uri", redirect_uri);
  upstream.searchParams.set("scope", scope);
  if (state) upstream.searchParams.set("state", state);
  upstream.searchParams.set("response_type", "code");
  return upstream.href;
}

/**
 * Exchanges an authorization code for an access token from Sentry.
 */
export async function exchangeCodeForAccessToken({
  client_id,
  client_secret,
  code,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  client_id: string;
}): Promise<[z.infer<typeof TokenResponseSchema>, null] | [null, Response]> {
  if (!code) {
    const eventId = logError("[oauth] Missing code in token exchange", {
      oauth: {
        client_id,
      },
    });
    return [
      null,
      new Response("Invalid request: missing authorization code", {
        status: 400,
        headers: { "X-Event-ID": eventId ?? "" },
      }),
    ];
  }

  const resp = await fetch(upstream_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Sentry MCP Cloudflare",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      client_secret,
      code,
    }).toString(),
  });
  if (!resp.ok) {
    const eventId = logError(
      `[oauth] Failed to exchange code for access token: ${await resp.text()}`,
      {
        oauth: {
          client_id,
        },
      },
    );
    return [
      null,
      new Response(
        "There was an issue authenticating your account and retrieving an access token. Please try again.",
        { status: 400, headers: { "X-Event-ID": eventId ?? "" } },
      ),
    ];
  }

  try {
    const body = await resp.json();
    const output = TokenResponseSchema.parse(body);
    return [output, null];
  } catch (e) {
    const eventId = logError(
      new Error("Failed to parse token response", {
        cause: e,
      }),
      {
        oauth: {
          client_id,
        },
      },
    );
    return [
      null,
      new Response(
        "There was an issue authenticating your account and retrieving an access token. Please try again.",
        { status: 500, headers: { "X-Event-ID": eventId ?? "" } },
      ),
    ];
  }
}

/**
 * Refreshes an access token using a refresh token from Sentry.
 */
export async function refreshAccessToken({
  client_id,
  client_secret,
  refresh_token,
  upstream_url,
}: {
  refresh_token: string | undefined;
  upstream_url: string;
  client_secret: string;
  client_id: string;
}): Promise<[z.infer<typeof TokenResponseSchema>, null] | [null, Response]> {
  if (!refresh_token) {
    const eventId = logError("[oauth] Missing refresh token in token refresh", {
      oauth: {
        client_id,
      },
    });
    return [
      null,
      new Response("Invalid request: missing refresh token", {
        status: 400,
        headers: { "X-Event-ID": eventId ?? "" },
      }),
    ];
  }

  const resp = await fetch(upstream_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Sentry MCP Cloudflare",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id,
      client_secret,
      refresh_token,
    }).toString(),
  });

  if (!resp.ok) {
    const eventId = logError(
      `[oauth] Failed to refresh access token: ${await resp.text()}`,
      {
        oauth: {
          client_id,
        },
      },
    );
    return [
      null,
      new Response(
        "There was an issue refreshing your access token. Please re-authenticate.",
        { status: 400, headers: { "X-Event-ID": eventId ?? "" } },
      ),
    ];
  }

  try {
    const body = await resp.json();
    const output = TokenResponseSchema.parse(body);
    return [output, null];
  } catch (e) {
    const eventId = logError(
      new Error("Failed to parse refresh token response", {
        cause: e,
      }),
      {
        oauth: {
          client_id,
        },
      },
    );
    return [
      null,
      new Response(
        "There was an issue refreshing your access token. Please re-authenticate.",
        { status: 500, headers: { "X-Event-ID": eventId ?? "" } },
      ),
    ];
  }
}

/**
 * Token exchange callback for handling Sentry OAuth token refreshes.
 */
export async function tokenExchangeCallback(
  options: TokenExchangeCallbackOptions,
  env: {
    SENTRY_CLIENT_ID: string;
    SENTRY_CLIENT_SECRET: string;
    SENTRY_HOST?: string;
  },
): Promise<TokenExchangeCallbackResult | undefined> {
  // Only handle refresh_token grant type
  if (options.grantType !== "refresh_token") {
    return undefined; // No-op for other grant types
  }

  // Extract the refresh token from the stored props
  const currentRefreshToken = options.props.refreshToken;

  if (!currentRefreshToken) {
    throw new Error("No refresh token available in stored props");
  }

  try {
    // If we have a cached upstream expiry, and there's ample time left,
    // avoid calling upstream to reduce unnecessary refreshes.
    // Mint a new provider token with the remaining TTL.
    const props = options.props as WorkerProps;
    const maybeExpiresAt = props.accessTokenExpiresAt;
    if (maybeExpiresAt && Number.isFinite(maybeExpiresAt)) {
      const remainingMs = maybeExpiresAt - Date.now();
      const SAFE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes safety window
      if (remainingMs > SAFE_WINDOW_MS) {
        const remainingSec = Math.floor(remainingMs / 1000);
        return {
          newProps: { ...options.props },
          accessTokenTTL: remainingSec,
        };
      }
    }

    // Construct the upstream token URL for Sentry
    const upstreamTokenUrl = new URL(
      SENTRY_TOKEN_URL,
      `https://${env.SENTRY_HOST || "sentry.io"}`,
    ).href;

    // Use our refresh token function to get new tokens from Sentry
    const [tokenResponse, errorResponse] = await refreshAccessToken({
      client_id: env.SENTRY_CLIENT_ID,
      client_secret: env.SENTRY_CLIENT_SECRET,
      refresh_token: currentRefreshToken,
      upstream_url: upstreamTokenUrl,
    });

    if (errorResponse) {
      // Convert the Response to an Error for the OAuth provider
      const errorText = await errorResponse.text();
      throw new Error(
        `Failed to refresh upstream token in OAuth provider: ${errorText}`,
      );
    }

    // Return the updated props with new tokens and TTL
    return {
      // This updates ctx.props
      newProps: {
        ...options.props,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        accessTokenExpiresAt: Date.now() + tokenResponse.expires_in * 1000,
      },
      accessTokenTTL: tokenResponse.expires_in,
    };
  } catch (error) {
    logError(error);
    throw new Error("Failed to refresh upstream token in OAuth provider", {
      cause: error,
    });
  }
}
