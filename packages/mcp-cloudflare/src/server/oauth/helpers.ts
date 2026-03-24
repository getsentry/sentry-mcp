import type {
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import type { z } from "zod";
import {
  ApiAuthenticationError,
  SentryApiService,
} from "@sentry/mcp-core/api-client";
import { logIssue } from "@sentry/mcp-core/telem/logging";
import { TokenResponseSchema } from "./constants";
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

export type TokenExchangeEnv = {
  SENTRY_HOST?: string;
};

/**
 * Handles Sentry OAuth token refreshes without ever refreshing upstream
 * (Sentry rotates both tokens on refresh, and the 30-day access token
 * lifetime makes re-auth acceptable).
 *
 * When the token looks valid locally, re-issues with remaining TTL.
 * When the clock says expired, probes upstream to verify before forcing re-auth.
 */
export async function tokenExchangeCallback(
  options: TokenExchangeCallbackOptions,
  env: TokenExchangeEnv,
): Promise<TokenExchangeCallbackResult | undefined> {
  if (options.grantType !== "refresh_token") {
    return undefined;
  }

  const props = options.props as WorkerProps;

  Sentry.setUser({ id: props.id });

  if (!props.refreshToken) {
    logIssue("No refresh token available in stored props", {
      loggerScope: ["cloudflare", "oauth", "refresh"],
    });
    return undefined;
  }

  const SAFE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
  const expiresAt = props.accessTokenExpiresAt;
  if (expiresAt && Number.isFinite(expiresAt)) {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs > SAFE_WINDOW_MS) {
      Sentry.metrics.count("mcp.oauth.token_exchange", 1, {
        attributes: { outcome: "success" },
      });
      return {
        newProps: props,
        accessTokenTTL: Math.floor(remainingMs / 1000),
      };
    }
  }

  // Probe upstream to check if the token is actually still valid
  try {
    const api = new SentryApiService({
      accessToken: props.accessToken,
      host: env.SENTRY_HOST || "sentry.io",
    });
    await api.getAuthenticatedUser();
    Sentry.metrics.count("mcp.oauth.token_exchange", 1, {
      attributes: { outcome: "success_probed" },
    });
    return {
      newProps: props,
      accessTokenTTL: 60 * 60,
    };
  } catch (error) {
    if (!(error instanceof ApiAuthenticationError)) {
      logIssue("Unexpected error probing upstream token validity", {
        loggerScope: ["cloudflare", "oauth", "refresh"],
        extra: { error },
      });
    }
  }

  Sentry.metrics.count("mcp.oauth.token_exchange", 1, {
    attributes: { outcome: "expired" },
  });
  return undefined;
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

  // RFC 8707 forbids fragment components entirely. `URL.hash` does not
  // distinguish an empty fragment (`https://host#`) from no fragment, so we
  // reject any raw `#` before parsing.
  if (resource.includes("#")) {
    return false;
  }

  try {
    const resourceUrl = new URL(resource);
    const requestUrlObj = new URL(requestUrl);
    const rawPath =
      resource
        .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "")
        .split(/[?#]/, 1)[0] || "/";

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

    // Reject any encoded path characters before URL normalization can collapse them.
    if (rawPath.includes("%")) {
      return false;
    }

    // Use the normalized pathname for the /mcp check so dot segments like
    // /mcp/../evil cannot bypass the prefix validation.
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
