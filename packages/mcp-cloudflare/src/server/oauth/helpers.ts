import type {
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import type { z } from "zod";
import { logIssue } from "@sentry/mcp-core/telem/logging";
import { TokenResponseSchema, SENTRY_TOKEN_URL } from "./constants";
import type { WorkerProps } from "../types";
import * as Sentry from "@sentry/cloudflare";

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
  redirect_uri,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  client_id: string;
  redirect_uri?: string;
}): Promise<[z.infer<typeof TokenResponseSchema>, null] | [null, Response]> {
  if (!code) {
    const eventId = logIssue("[oauth] Missing code in token exchange", {
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
      ...(redirect_uri ? { redirect_uri } : {}),
    }).toString(),
  });
  if (!resp.ok) {
    const responseText = await resp.text();
    const eventId = logIssue(
      `[oauth] Failed to exchange code for access token: ${responseText}`,
      {
        oauth: {
          client_id,
          status: resp.status,
          statusText: resp.statusText,
          hasRedirectUri: !!redirect_uri,
          redirectUri: redirect_uri,
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
    const eventId = logIssue(
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
    const eventId = logIssue("[oauth] Missing refresh token in token refresh", {
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
    const eventId = logIssue(
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
    const eventId = logIssue(
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

// KV-based distributed lock to prevent concurrent upstream refreshes.
// Sentry rotates refresh tokens on use — if two isolates call /oauth/token/
// with the same refresh token, the first wins and the second gets
// invalid_grant. The lock + result cache ensures only one isolate refreshes
// per user; others wait and reuse the cached result.
// NOTE: Cloudflare KV requires expirationTtl >= 60 seconds.
const LOCK_TTL_SECONDS = 60;
const RESULT_TTL_SECONDS = 60;
const LOCK_WAIT_MS = 2000;

interface CachedRefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type TokenExchangeEnv = {
  SENTRY_CLIENT_ID: string;
  SENTRY_CLIENT_SECRET: string;
  SENTRY_HOST?: string;
  OAUTH_KV: KVNamespace;
};

/**
 * Token exchange callback for handling Sentry OAuth token refreshes.
 */
export async function tokenExchangeCallback(
  options: TokenExchangeCallbackOptions,
  env: TokenExchangeEnv,
): Promise<TokenExchangeCallbackResult | undefined> {
  // Only handle refresh_token grant type
  if (options.grantType !== "refresh_token") {
    return undefined; // No-op for other grant types
  }

  const props = options.props as WorkerProps;

  Sentry.setUser({ id: props.id });

  if (!props.refreshToken) {
    logIssue("No refresh token available in stored props", {
      loggerScope: ["cloudflare", "oauth", "refresh"],
    });
    return undefined;
  }

  // If the upstream token has ample time left, skip the refresh and
  // mint a new provider token with the remaining TTL.
  const SAFE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
  const expiresAt = props.accessTokenExpiresAt;
  if (expiresAt && Number.isFinite(expiresAt)) {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs > SAFE_WINDOW_MS) {
      return {
        newProps: props,
        accessTokenTTL: Math.floor(remainingMs / 1000),
      };
    }
  }

  const userId = props.id;
  const resultKey = `refresh-result:${userId}`;
  const lockKey = `refresh-lock:${userId}`;

  // Check for a recently cached refresh result from another isolate
  const cached = await env.OAUTH_KV.get<CachedRefreshResult>(resultKey, "json");
  if (cached) {
    return buildResultFromCache(props, cached);
  }

  // Check if another isolate is already refreshing
  const lockHolder = await env.OAUTH_KV.get(lockKey);
  if (lockHolder) {
    // Wait for the other isolate to finish, then check for its result
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    const result = await env.OAUTH_KV.get<CachedRefreshResult>(
      resultKey,
      "json",
    );
    if (result) {
      return buildResultFromCache(props, result);
    }
    // Lock holder may have failed — fall through and try ourselves
  }

  // Acquire lock and perform the upstream refresh
  await env.OAUTH_KV.put(lockKey, Date.now().toString(), {
    expirationTtl: LOCK_TTL_SECONDS,
  });

  try {
    const result = await doUpstreamRefresh(props, env);

    // Cache the result for other isolates (best-effort — a KV failure
    // must not discard a successful refresh, since the upstream provider
    // may have already rotated the refresh token).
    if (result) {
      const newProps = result.newProps as WorkerProps;
      const cacheValue: CachedRefreshResult = {
        accessToken: newProps.accessToken,
        refreshToken: newProps.refreshToken!,
        expiresAt: newProps.accessTokenExpiresAt!,
      };
      try {
        await env.OAUTH_KV.put(resultKey, JSON.stringify(cacheValue), {
          expirationTtl: RESULT_TTL_SECONDS,
        });
      } catch {
        // Best-effort cache write — other isolates will refresh themselves
      }
    }

    return result;
  } finally {
    try {
      await env.OAUTH_KV.delete(lockKey);
    } catch {
      // Best-effort lock cleanup — the lock has a TTL and will expire
    }
  }
}

function buildResultFromCache(
  props: WorkerProps,
  cached: CachedRefreshResult,
): TokenExchangeCallbackResult {
  return {
    newProps: {
      ...props,
      accessToken: cached.accessToken,
      refreshToken: cached.refreshToken,
      accessTokenExpiresAt: cached.expiresAt,
    },
    accessTokenTTL: Math.max(
      1,
      Math.floor((cached.expiresAt - Date.now()) / 1000),
    ),
  };
}

async function doUpstreamRefresh(
  props: WorkerProps,
  env: TokenExchangeEnv,
): Promise<TokenExchangeCallbackResult | undefined> {
  const upstreamTokenUrl = new URL(
    SENTRY_TOKEN_URL,
    `https://${env.SENTRY_HOST || "sentry.io"}`,
  ).href;

  const [tokenResponse, errorResponse] = await refreshAccessToken({
    client_id: env.SENTRY_CLIENT_ID,
    client_secret: env.SENTRY_CLIENT_SECRET,
    refresh_token: props.refreshToken,
    upstream_url: upstreamTokenUrl,
  });

  if (errorResponse) {
    const errorText = await errorResponse.text();
    logIssue(`[oauth] Failed to refresh upstream token: ${errorText}`, {
      loggerScope: ["cloudflare", "oauth", "refresh"],
    });
    throw new Error(
      `Failed to refresh upstream token in OAuth provider: ${errorText}`,
    );
  }

  if (!tokenResponse.refresh_token) {
    logIssue("[oauth] Upstream refresh response missing refresh_token", {
      loggerScope: ["cloudflare", "oauth", "refresh"],
    });
    return undefined;
  }

  return {
    newProps: {
      ...props,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      accessTokenExpiresAt: Date.now() + tokenResponse.expires_in * 1000,
    },
    accessTokenTTL: tokenResponse.expires_in,
  };
}

/**
 * Validates resource parameter per RFC 8707.
 */
export function validateResourceParameter(
  resource: string | undefined,
  requestUrl: string,
): boolean {
  if (resource === "") {
    return false;
  }

  if (!resource) {
    return true;
  }

  try {
    const resourceUrl = new URL(resource);
    const requestUrlObj = new URL(requestUrl);

    // RFC 8707: resource URI must not include fragment
    if (resourceUrl.hash) {
      return false;
    }

    // Must use same protocol
    if (resourceUrl.protocol !== requestUrlObj.protocol) {
      return false;
    }

    if (resourceUrl.hostname !== requestUrlObj.hostname) {
      return false;
    }

    // Normalize default ports for comparison
    const getPort = (url: URL) =>
      url.port || (url.protocol === "https:" ? "443" : "80");

    if (getPort(resourceUrl) !== getPort(requestUrlObj)) {
      return false;
    }

    // Reject url-encoded characters in pathname
    if (resourceUrl.pathname.includes("%")) {
      return false;
    }

    // Validate path is exactly /mcp or starts with /mcp/
    return (
      resourceUrl.pathname === "/mcp" ||
      resourceUrl.pathname.startsWith("/mcp/")
    );
  } catch {
    return false;
  }
}

/**
 * Creates RFC 8707 error response for invalid resource parameter.
 */
export function createResourceValidationError(
  redirectUri: string,
  state?: string,
): Response {
  const redirectUrl = new URL(redirectUri);

  redirectUrl.searchParams.set("error", "invalid_target");
  redirectUrl.searchParams.set(
    "error_description",
    "The resource parameter does not match this authorization server",
  );

  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl.href,
    },
  });
}
