import type {
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import type { z } from "zod";
import {
  ApiClientError,
  ApiRateLimitError,
  SentryApiService,
} from "@sentry/mcp-core/api-client";
import { logIssue, logWarn } from "@sentry/mcp-core/telem/logging";
import { TokenResponseSchema } from "./constants";
import type { WorkerProps } from "../types";
import * as Sentry from "@sentry/cloudflare";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type OAuthFailureDetails = {
  message: string;
  status: number;
  shouldLogIssue: boolean;
};

const userFailure = (message: string, status = 400): OAuthFailureDetails => ({
  message,
  status,
  shouldLogIssue: false,
});

const systemFailure = (message: string, status = 502): OAuthFailureDetails => ({
  message,
  status,
  shouldLogIssue: true,
});

function isRetryableInvalidGrant(errorDescription?: string): boolean {
  if (!errorDescription) {
    return false;
  }

  const normalized = errorDescription.toLowerCase();
  const userRetryablePatterns = [
    "expired",
    "already used",
    "already been used",
    "invalid or expired",
    "authorization code expired",
  ];
  const systemMismatchPatterns = [
    "redirect_uri",
    "client_id",
    "pkce",
    "code verifier",
    "code_verifier",
    "mismatch",
  ];

  return (
    userRetryablePatterns.some((pattern) => normalized.includes(pattern)) &&
    !systemMismatchPatterns.some((pattern) => normalized.includes(pattern))
  );
}

export function getOAuthCallbackFailureDetails({
  oauthError,
}: {
  oauthError?: string;
}): OAuthFailureDetails {
  switch (oauthError) {
    case "access_denied":
      return userFailure(
        "Authorization was denied. Please try again if you want to continue connecting your account.",
      );
    case "invalid_request":
      return userFailure(
        "The authorization request was rejected. Please try again.",
      );
    case "temporarily_unavailable":
      return systemFailure(
        "Sentry OAuth is temporarily unavailable. Please try again shortly.",
        503,
      );
    case "server_error":
      return systemFailure(
        "Sentry OAuth encountered an internal error. Please try again.",
      );
    case "invalid_scope":
      return systemFailure(
        "The requested permissions were invalid. Please try again.",
      );
    case "invalid_client":
    case "unauthorized_client":
    case "unsupported_response_type":
      return systemFailure(
        "There was an internal configuration issue completing authentication. Please try again later.",
        500,
      );
    default:
      return userFailure(
        "There was an issue authenticating your account. Please try again.",
      );
  }
}

export function getTokenExchangeFailureDetails({
  oauthError,
  errorDescription,
}: {
  oauthError?: string;
  errorDescription?: string;
}): OAuthFailureDetails {
  switch (oauthError) {
    case "access_denied":
      return userFailure(
        "Authorization was denied. Please try again if you want to continue connecting your account.",
      );
    case "temporarily_unavailable":
      return systemFailure(
        "Sentry OAuth is temporarily unavailable. Please try again shortly.",
        503,
      );
    case "server_error":
      return systemFailure(
        "Sentry OAuth encountered an internal error. Please try again.",
      );
    case "invalid_request":
      return systemFailure(
        "The authorization request was rejected. Please try again.",
      );
    case "invalid_grant":
      if (isRetryableInvalidGrant(errorDescription)) {
        return userFailure(
          "The authorization code was invalid or expired. Please try connecting your account again.",
        );
      }

      return systemFailure(
        "The authorization code could not be validated. Please try again.",
      );
    case "invalid_scope":
      return systemFailure(
        "The requested permissions were invalid. Please try again.",
      );
    case "invalid_client":
    case "unauthorized_client":
    case "unsupported_grant_type":
      return systemFailure(
        "There was an internal configuration issue completing authentication. Please try again later.",
        500,
      );
    default:
      return systemFailure(
        "There was an internal error authenticating your account. Please try again shortly.",
      );
  }
}

export function createOAuthFailureResponse({
  title = "Authentication Failed",
  message,
  status,
  oauthError,
  eventId,
}: {
  title?: string;
  message: string;
  status: number;
  oauthError?: string;
  eventId?: string;
}): Response {
  const details = [
    oauthError
      ? `<p><strong>OAuth Error:</strong> ${escapeHtml(oauthError)}</p>`
      : "",
    eventId
      ? `<p><strong>Event ID:</strong> <code>${escapeHtml(eventId)}</code></p>`
      : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      main {
        max-width: 640px;
        margin: 10vh auto;
        padding: 32px 24px;
        background: #111827;
        border: 1px solid #334155;
        border-radius: 16px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 16px;
        font-size: 1.75rem;
      }
      p {
        line-height: 1.6;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 0.95em;
      }
      .details {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid #334155;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <p>If the issue persists, try again or contact support.</p>
      <div class="details">${details}</div>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

type ParsedUpstreamOAuthError = {
  error?: string;
  errorDescription?: string;
};

type StoredGrantProps = Record<string, unknown> & Partial<WorkerProps>;

function parseUpstreamOAuthError(
  responseText: string,
  contentType: string | null,
): ParsedUpstreamOAuthError {
  if (!contentType?.includes("application/json")) {
    return {};
  }

  try {
    const parsed = JSON.parse(responseText) as {
      error?: unknown;
      error_description?: unknown;
    };

    return {
      error: typeof parsed.error === "string" ? parsed.error : undefined,
      errorDescription:
        typeof parsed.error_description === "string"
          ? parsed.error_description
          : undefined,
    };
  } catch {
    return {};
  }
}

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
    logWarn("[oauth] Missing code in token exchange", {
      contexts: {
        oauth: {
          client_id,
          hasRedirectUri: !!redirect_uri,
          redirectUri: redirect_uri,
        },
      },
      loggerScope: ["cloudflare", "oauth", "callback"],
    });
    return [
      null,
      createOAuthFailureResponse({
        message:
          "The authorization callback did not include an authorization code.",
        status: 400,
      }),
    ] as const;
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
    const contentType = resp.headers.get("Content-Type");
    const upstreamError = parseUpstreamOAuthError(responseText, contentType);
    const failure = getTokenExchangeFailureDetails({
      oauthError: upstreamError.error,
      errorDescription: upstreamError.errorDescription,
    });
    const logOptions = {
      contexts: {
        oauth: {
          client_id,
          status: resp.status,
          statusText: resp.statusText,
          hasRedirectUri: !!redirect_uri,
          redirectUri: redirect_uri,
          upstreamError: upstreamError.error,
          hasUpstreamErrorDescription: !!upstreamError.errorDescription,
          contentType,
        },
      },
      extra: {
        responseBodyPreview: responseText.slice(0, 1000),
      },
      loggerScope: ["cloudflare", "oauth", "callback"],
    } as const;
    let eventId: string | undefined;
    if (failure.shouldLogIssue) {
      eventId = logIssue(
        "[oauth] Failed to exchange code for access token",
        logOptions,
      );
    } else {
      logWarn("[oauth] Failed to exchange code for access token", logOptions);
    }
    return [
      null,
      createOAuthFailureResponse({
        message: failure.message,
        status: failure.status,
        oauthError: upstreamError.error,
        eventId,
      }),
    ] as const;
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
        contexts: {
          oauth: {
            client_id,
          },
        },
        loggerScope: ["cloudflare", "oauth", "callback"],
      },
    );
    return [
      null,
      createOAuthFailureResponse({
        message:
          "There was an internal error authenticating your account and retrieving an access token. Please try again.",
        status: 500,
        eventId,
      }),
    ] as const;
  }
}

export type TokenExchangeEnv = {
  SENTRY_HOST?: string;
};

export type TokenExchangeOutcome =
  | "cached_token_still_valid_local"
  | "cached_token_still_valid_probed"
  | "upstream_token_invalid"
  | "verification_indeterminate";

const SAFE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const PROBED_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

function recordTokenExchangeOutcome(
  outcome: TokenExchangeOutcome,
  attributes?: Record<string, string>,
): void {
  Sentry.metrics.count("mcp.oauth.token_exchange", 1, {
    attributes: {
      outcome,
      ...attributes,
    },
  });
}

function buildSuccessfulTokenExchangeResult<
  TProps extends Record<string, unknown>,
>(props: TProps, accessTokenTTL: number): TokenExchangeCallbackResult {
  return {
    newProps: props,
    accessTokenTTL,
  };
}

function buildInvalidGrantTokenExchangeResult(
  props: WorkerProps & Record<string, unknown>,
): TokenExchangeCallbackResult {
  const invalidProps = {
    ...props,
    upstreamTokenInvalid: true,
  } satisfies WorkerProps & Record<string, unknown>;

  return {
    newProps: invalidProps,
    accessTokenProps: invalidProps,
  };
}

async function probeUpstreamAccessToken(
  props: WorkerProps,
  env: TokenExchangeEnv,
): Promise<TokenExchangeOutcome> {
  try {
    const api = new SentryApiService({
      accessToken: props.accessToken,
      host: env.SENTRY_HOST || "sentry.io",
    });
    await api.getAuthenticatedUser();
    return "cached_token_still_valid_probed";
  } catch (error) {
    if (error instanceof ApiRateLimitError) {
      return "verification_indeterminate";
    }

    if (error instanceof ApiClientError) {
      return "upstream_token_invalid";
    }

    if (typeof error === "object" && error !== null) {
      const status = "status" in error ? error.status : undefined;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return "upstream_token_invalid";
      }
    }

    logIssue(error, {
      loggerScope: ["cloudflare", "oauth", "refresh"],
    });
    return "verification_indeterminate";
  }
}

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

  const rawProps = options.props as StoredGrantProps;

  Sentry.setUser({ id: rawProps.id });

  if (!rawProps.refreshToken) {
    // Stale grant from before refreshToken was stored in props.
    // The MCP handler will revoke this grant on the next /mcp request.
    return undefined;
  }

  const { upstreamTokenInvalid: _ignoredUpstreamTokenInvalid, ...baseProps } =
    rawProps;

  const props = {
    ...baseProps,
    id: rawProps.id as string,
    accessToken: rawProps.accessToken as string,
    refreshToken: rawProps.refreshToken,
    accessTokenExpiresAt: rawProps.accessTokenExpiresAt,
    clientId: rawProps.clientId as string,
    scope: rawProps.scope as string,
    grantedScopes: rawProps.grantedScopes,
    grantedSkills: rawProps.grantedSkills,
  } satisfies WorkerProps & Record<string, unknown>;

  const expiresAt = props.accessTokenExpiresAt;
  if (expiresAt && Number.isFinite(expiresAt)) {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs > SAFE_WINDOW_MS) {
      recordTokenExchangeOutcome("cached_token_still_valid_local", {
        grant_shape: "refreshable",
      });
      return buildSuccessfulTokenExchangeResult(
        props,
        Math.floor(remainingMs / 1000),
      );
    }
  }

  // Probe upstream to check if the token is actually still valid. Sentry can
  // report invalid/expired bearer tokens here as 400 or 401, so treat any 4xx
  // as an expected probe failure and fall back to re-auth without creating an
  // issue.
  const outcome = await probeUpstreamAccessToken(props, env);
  switch (outcome) {
    case "cached_token_still_valid_probed":
      recordTokenExchangeOutcome(outcome, {
        grant_shape: "refreshable",
      });
      return buildSuccessfulTokenExchangeResult(
        props,
        PROBED_ACCESS_TOKEN_TTL_SECONDS,
      );
    case "upstream_token_invalid":
      recordTokenExchangeOutcome(outcome, {
        grant_shape: "refreshable",
      });
      return buildInvalidGrantTokenExchangeResult(props);
    case "verification_indeterminate":
      recordTokenExchangeOutcome(outcome, {
        grant_shape: "refreshable",
      });
      return undefined;
    default:
      return undefined;
  }
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
