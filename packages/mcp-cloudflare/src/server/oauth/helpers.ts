import * as Sentry from "@sentry/cloudflare";
import { logIssue, logWarn } from "@sentry/mcp-core/telem/logging";
import type { z } from "zod";
import { SENTRY_TOKEN_URL, TokenResponseSchema } from "./constants";
import {
  encryptPropsWithNewKey,
  generateAuthCode,
  generateGrantId,
  hashSecret,
  wrapKeyWithToken,
} from "./crypto";
import type { OAuthStorage } from "./storage";
import type {
  AuthRequest,
  ClientInfo,
  CompleteAuthorizationOptions,
  CompleteAuthorizationResult,
  Grant,
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from "./types";

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
    const eventId = logWarn("[oauth] Missing code in token exchange", {
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
    const logFn = resp.status >= 500 ? logIssue : logWarn;
    const eventId = logFn(
      `[oauth] Failed to exchange code for access token: ${responseText}`,
      {
        oauth: {
          client_id,
          status: resp.status,
          statusText: resp.statusText,
          hasRedirectUri: !!redirect_uri,
          redirectUri: redirect_uri,
          hasCode: !!code,
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
    const eventId = logWarn("[oauth] Missing refresh token in token refresh", {
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
    const logFn = resp.status >= 500 ? logIssue : logWarn;
    const eventId = logFn(
      `[oauth] Failed to refresh access token: ${await resp.text()}`,
      {
        oauth: {
          client_id,
          status: resp.status,
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

/** Safety window for upstream token refresh (2 minutes) */
const SAFE_WINDOW_MS = 2 * 60 * 1000;

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
  if (options.grantType !== "refresh_token") {
    return undefined;
  }

  Sentry.setUser({ id: options.props.id });

  const { refreshToken, accessTokenExpiresAt } = options.props;
  if (!refreshToken) {
    logIssue("No refresh token available in stored props", {
      loggerScope: ["cloudflare", "oauth", "refresh"],
    });
    return undefined;
  }

  // If upstream token is still valid with safety margin, reuse it
  if (accessTokenExpiresAt && Number.isFinite(accessTokenExpiresAt)) {
    const remainingMs = accessTokenExpiresAt - Date.now();
    if (remainingMs > SAFE_WINDOW_MS) {
      return {
        newProps: { ...options.props },
        accessTokenTTL: Math.floor(remainingMs / 1000),
      };
    }
  }

  // Refresh upstream token
  try {
    const upstreamTokenUrl = new URL(
      SENTRY_TOKEN_URL,
      `https://${env.SENTRY_HOST || "sentry.io"}`,
    ).href;

    const [tokenResponse, errorResponse] = await refreshAccessToken({
      client_id: env.SENTRY_CLIENT_ID,
      client_secret: env.SENTRY_CLIENT_SECRET,
      refresh_token: refreshToken,
      upstream_url: upstreamTokenUrl,
    });

    if (errorResponse) {
      const errorText = await errorResponse.text();
      throw new Error(`Failed to refresh upstream token: ${errorText}`);
    }

    if (!tokenResponse.refresh_token) {
      // Use logWarn not logIssue - missing refresh_token is likely an upstream
      // config/contract issue, not a system failure requiring alerting
      logWarn("[oauth] Upstream refresh response missing refresh_token", {
        loggerScope: ["cloudflare", "oauth", "refresh"],
      });
      return undefined;
    }

    return {
      newProps: {
        ...options.props,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        accessTokenExpiresAt: Date.now() + tokenResponse.expires_in * 1000,
      },
      accessTokenTTL: tokenResponse.expires_in,
    };
  } catch (error) {
    // Don't log here - refreshAccessToken already logs appropriately
    // (logWarn for 4xx user errors, logIssue for 5xx system errors)
    throw new Error("Failed to refresh upstream token in OAuth provider", {
      cause: error,
    });
  }
}

/**
 * Validates resource parameter per RFC 8707.
 * Supports both single resource string and array of resource strings.
 */
export function validateResourceParameter(
  resource: string | string[] | undefined,
  requestUrl: string,
): boolean {
  if (resource === "") {
    return false;
  }

  if (!resource) {
    return true;
  }

  // If array, validate each resource
  if (Array.isArray(resource)) {
    return resource.every((r) => validateResourceParameter(r, requestUrl));
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

// =============================================================================
// OAuth Provider Helpers
// =============================================================================

/**
 * OAuth helpers interface matching the OAUTH_PROVIDER service binding.
 *
 * This provides the methods needed by the authorize and callback routes
 * to implement the OAuth authorization code flow.
 */
export interface OAuthHelpers {
  /**
   * Parse an OAuth authorization request from the HTTP request.
   *
   * Extracts and validates OAuth parameters from the request URL.
   *
   * @see RFC 6749 Section 4.1.1 - Authorization Request
   */
  parseAuthRequest(request: Request): Promise<AuthRequest>;

  /**
   * Look up a client by its client ID.
   *
   * @see RFC 7591 Section 3.2.1 - Client Information Response
   */
  lookupClient(clientId: string): Promise<ClientInfo | null>;

  /**
   * Complete an authorization request by creating a grant and auth code.
   *
   * Creates the grant, encrypts props, generates auth code, and returns
   * the redirect URL with the authorization code.
   *
   * @see RFC 6749 Section 4.1.2 - Authorization Response
   */
  completeAuthorization(
    options: CompleteAuthorizationOptions,
  ): Promise<CompleteAuthorizationResult>;
}

/**
 * Create OAuth helpers bound to a storage instance.
 *
 * @param storage - OAuth storage instance
 * @returns OAuth helpers implementation
 */
export function createOAuthHelpers(storage: OAuthStorage): OAuthHelpers {
  return {
    async parseAuthRequest(request: Request): Promise<AuthRequest> {
      const url = new URL(request.url);

      // RFC 6749 Section 4.1.1: Extract authorization request parameters
      const responseType = url.searchParams.get("response_type") || "";
      const clientId = url.searchParams.get("client_id") || "";
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const scope = (url.searchParams.get("scope") || "")
        .split(" ")
        .filter(Boolean);
      const state = url.searchParams.get("state") || "";

      // RFC 7636: PKCE parameters
      const codeChallenge = url.searchParams.get("code_challenge") || undefined;
      const codeChallengeMethod =
        url.searchParams.get("code_challenge_method") || "plain";

      // RFC 8707: Resource indicator (may have multiple values)
      const resourceParams = url.searchParams.getAll("resource");
      const resource =
        resourceParams.length > 0
          ? resourceParams.length === 1
            ? resourceParams[0]
            : resourceParams
          : undefined;

      // Validate redirect URI scheme to prevent javascript: URIs / XSS attacks
      if (redirectUri) {
        try {
          const redirectUrl = new URL(redirectUri);
          const scheme = redirectUrl.protocol.toLowerCase();
          if (!["http:", "https:"].includes(scheme)) {
            throw new Error(
              `Invalid redirect URI scheme: ${scheme}. Only http and https are allowed.`,
            );
          }
        } catch (e) {
          if (
            e instanceof Error &&
            e.message.includes("Invalid redirect URI")
          ) {
            throw e;
          }
          throw new Error(`Invalid redirect URI: ${redirectUri}`);
        }
      }

      // RFC 6749 Section 4.1.1: Validate response_type
      // We only support authorization code flow, not implicit grant
      if (responseType !== "code") {
        throw new Error(
          `Unsupported response_type: ${responseType || "(missing)"}. Only "code" is supported.`,
        );
      }

      // Validate client and redirect URI if client exists
      if (clientId) {
        const clientInfo = await storage.getClient(clientId);
        if (!clientInfo) {
          throw new Error(
            "Invalid client. The clientId provided does not match to this client.",
          );
        }

        // Validate redirect URI against registered URIs
        if (redirectUri && !clientInfo.redirectUris.includes(redirectUri)) {
          throw new Error(
            "Invalid redirect URI. The redirect URI provided does not match any registered URI for this client.",
          );
        }
      }

      return {
        responseType,
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        resource,
      };
    },

    async lookupClient(clientId: string): Promise<ClientInfo | null> {
      return storage.getClient(clientId);
    },

    async completeAuthorization(
      options: CompleteAuthorizationOptions,
    ): Promise<CompleteAuthorizationResult> {
      const { request, userId, scope, props, metadata } = options;
      const {
        clientId,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod,
        resource,
      } = request;

      if (!clientId || !redirectUri) {
        throw new Error(
          "Client ID and Redirect URI are required in the authorization request.",
        );
      }

      // Re-validate the redirectUri to prevent open redirect vulnerabilities
      const clientInfo = await storage.getClient(clientId);
      if (!clientInfo || !clientInfo.redirectUris.includes(redirectUri)) {
        throw new Error(
          "Invalid redirect URI. The redirect URI provided does not match any registered URI for this client.",
        );
      }

      // Generate grant and auth code
      const grantId = generateGrantId();
      const authCode = generateAuthCode(userId, grantId);
      const authCodeId = await hashSecret(authCode);

      // Encrypt props with a new key
      const { encrypted, key: encryptionKey } =
        await encryptPropsWithNewKey(props);

      // Wrap the encryption key with the auth code
      const authCodeWrappedKey = await wrapKeyWithToken(
        authCode,
        encryptionKey,
      );

      const now = Math.floor(Date.now() / 1000);

      // Create grant record
      const grant: Grant = {
        id: grantId,
        clientId,
        userId,
        scope,
        metadata,
        encryptedProps: JSON.stringify(encrypted),
        createdAt: now,
        authCodeId,
        authCodeWrappedKey,
        codeChallenge,
        codeChallengeMethod,
        resource,
        redirectUri,
      };

      // Save grant with 10-minute TTL (extended when code is exchanged)
      const codeExpiresIn = 600;
      await storage.saveGrant(grant, codeExpiresIn);

      // Build redirect URL with authorization code
      // RFC 6749 Section 4.1.2: Authorization Response
      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set("code", authCode);
      if (state) {
        redirectUrl.searchParams.set("state", state);
      }

      return { redirectTo: redirectUrl.toString() };
    },
  };
}
