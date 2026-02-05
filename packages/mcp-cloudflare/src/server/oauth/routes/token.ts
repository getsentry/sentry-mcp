/**
 * OAuth Token Endpoint
 *
 * Handles token requests per RFC 6749 Section 4.1.3 (Authorization Code)
 * and Section 6 (Refreshing an Access Token).
 *
 * This endpoint:
 * 1. Exchanges authorization codes for access/refresh tokens
 * 2. Refreshes expired access tokens using refresh tokens
 * 3. Optionally refreshes upstream Sentry tokens when MCP tokens are refreshed
 *
 * @see RFC 6749 Section 4.1.3 - Access Token Request
 * @see RFC 6749 Section 5.1 - Successful Response
 * @see RFC 6749 Section 5.2 - Error Response
 * @see RFC 6749 Section 6 - Refreshing an Access Token
 * @see RFC 7636 Section 4.5 - Client Sends the Authorization Code
 */

import { logIssue, logWarn } from "@sentry/mcp-core/telem/logging";
import { type Context, Hono } from "hono";
import type { Env } from "../../types";
import { SENTRY_TOKEN_URL } from "../constants";
import {
  decryptProps,
  encryptProps,
  generateEncryptionKey,
  generateToken,
  generateTokenId,
  hashSecret,
  parseToken,
  unwrapKeyWithToken,
  verifyCodeChallenge,
  verifySecret,
  wrapKeyWithToken,
} from "../crypto";
import { refreshAccessToken } from "../helpers";
import type { OAuthStorage } from "../storage";
import type {
  ClientInfo,
  Grant,
  Token,
  TokenErrorResponse,
  TokenResponse,
  WorkerProps,
} from "../types";

// =============================================================================
// Configuration
// =============================================================================

/** Default access token TTL in seconds (1 hour) */
const DEFAULT_ACCESS_TOKEN_TTL = 3600;

/** Default refresh token TTL in seconds (30 days) */
const DEFAULT_REFRESH_TOKEN_TTL = 30 * 24 * 3600;

/** Safety window for upstream token refresh (2 minutes) */
const UPSTREAM_REFRESH_SAFETY_WINDOW_MS = 2 * 60 * 1000;

// =============================================================================
// Client Authentication (RFC 6749 Section 2.3)
// =============================================================================

/**
 * Extract client credentials from the request.
 *
 * Supports two authentication methods:
 * - client_secret_basic: HTTP Basic authentication (RFC 6749 Section 2.3.1)
 * - client_secret_post: Credentials in request body (RFC 6749 Section 2.3.1)
 *
 * @param c - Hono context
 * @param body - Parsed request body
 * @returns Client ID and secret, or null if no credentials provided
 */
function extractClientCredentials(
  c: Context<{ Bindings: Env }>,
  body: Record<string, string | undefined>,
): { clientId: string; clientSecret: string } | null {
  // Check for HTTP Basic authentication (client_secret_basic)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Basic ")) {
    try {
      const encoded = authHeader.slice(6);
      const decoded = atob(encoded);
      const colonIndex = decoded.indexOf(":");
      if (colonIndex !== -1) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, colonIndex)),
          clientSecret: decodeURIComponent(decoded.slice(colonIndex + 1)),
        };
      }
    } catch {
      // Invalid base64, fall through to body check
    }
  }

  // Check for credentials in body (client_secret_post)
  if (body.client_id && body.client_secret) {
    return {
      clientId: body.client_id,
      clientSecret: body.client_secret,
    };
  }

  return null;
}

/**
 * Verify client authentication for confidential clients.
 *
 * @see RFC 6749 Section 2.3 - Client Authentication
 *
 * @param c - Hono context
 * @param body - Parsed request body
 * @param storage - OAuth storage
 * @returns Client info if authenticated, or error response
 */
async function authenticateClient(
  c: Context<{ Bindings: Env }>,
  body: Record<string, string | undefined>,
  storage: OAuthStorage,
): Promise<
  { client: ClientInfo; error: null } | { client: null; error: Response }
> {
  // Get client_id from credentials or body
  const credentials = extractClientCredentials(c, body);
  const clientId = credentials?.clientId || body.client_id;

  if (!clientId) {
    return {
      client: null,
      error: oauthError(
        c,
        "invalid_request",
        "Missing required parameter: client_id",
      ),
    };
  }

  // Look up client
  const client = await storage.getClient(clientId);
  if (!client) {
    // RFC 6749 Section 5.2: invalid_client SHOULD return 401
    return {
      client: null,
      error: oauthError(c, "invalid_client", "Unknown client", 401),
    };
  }

  // Check if client requires authentication
  if (client.tokenEndpointAuthMethod === "none") {
    // Public client - no secret required
    return { client, error: null };
  }

  // Confidential client - must provide valid credentials
  if (!credentials) {
    // RFC 6749 Section 5.2: invalid_client SHOULD return 401
    return {
      client: null,
      error: oauthError(
        c,
        "invalid_client",
        "Client authentication required",
        401,
      ),
    };
  }

  // Verify client secret
  if (!client.clientSecret) {
    // This shouldn't happen - confidential clients should have a secret
    return {
      client: null,
      error: oauthError(c, "server_error", "Client configuration error", 500),
    };
  }

  const secretValid = await verifySecret(
    credentials.clientSecret,
    client.clientSecret,
  );
  if (!secretValid) {
    // RFC 6749 Section 5.2: invalid_client SHOULD return 401
    return {
      client: null,
      error: oauthError(c, "invalid_client", "Invalid client credentials", 401),
    };
  }

  return { client, error: null };
}

// =============================================================================
// Route Handler
// =============================================================================

const tokenRoute = new Hono<{ Bindings: Env }>();

/**
 * POST /oauth/token
 *
 * Token endpoint supporting:
 * - grant_type=authorization_code: Exchange auth code for tokens
 * - grant_type=refresh_token: Get new access token using refresh token
 *
 * @see RFC 6749 Section 4.1.3
 * @see RFC 6749 Section 6
 */
tokenRoute.post("/", async (c) => {
  // Parse form body (RFC 6749 requires application/x-www-form-urlencoded)
  const body = (await c.req.parseBody()) as Record<string, string | undefined>;
  const grantType = body.grant_type;

  // Get storage from context (injected by middleware)
  const storage = c.get("oauthStorage") as OAuthStorage;
  if (!storage) {
    return oauthError(c, "server_error", "OAuth storage not configured", 500);
  }

  // Authenticate client (RFC 6749 Section 2.3)
  const authResult = await authenticateClient(c, body, storage);
  if (authResult.error) {
    return authResult.error;
  }
  const client = authResult.client;

  switch (grantType) {
    case "authorization_code":
      return handleAuthorizationCodeGrant(c, body, storage, client);

    case "refresh_token":
      return handleRefreshTokenGrant(c, body, storage, client);

    default:
      // RFC 6749 Section 5.2: unsupported_grant_type
      return oauthError(
        c,
        "unsupported_grant_type",
        `Grant type '${grantType}' is not supported. Supported types: authorization_code, refresh_token`,
      );
  }
});

// =============================================================================
// Authorization Code Grant (RFC 6749 Section 4.1.3)
// =============================================================================

/**
 * Handle authorization_code grant type.
 *
 * Validates the authorization code and exchanges it for access/refresh tokens.
 * Also verifies PKCE code_verifier if code_challenge was provided during authorization.
 *
 * @see RFC 6749 Section 4.1.3
 * @see RFC 7636 Section 4.5
 */
async function handleAuthorizationCodeGrant(
  c: Context<{ Bindings: Env }>,
  body: Record<string, string | undefined>,
  storage: OAuthStorage,
  client: ClientInfo,
): Promise<Response> {
  const code = body.code;
  const redirectUri = body.redirect_uri;
  const codeVerifier = body.code_verifier;

  // RFC 6749 Section 4.1.3: code is REQUIRED
  if (!code) {
    return oauthError(c, "invalid_request", "Missing required parameter: code");
  }

  // Parse the authorization code to extract userId and grantId
  const parsed = parseToken(code);
  if (!parsed) {
    return oauthError(c, "invalid_grant", "Invalid authorization code format");
  }

  const { userId, grantId } = parsed;

  // Look up the grant
  const grant = await storage.getGrant(userId, grantId);
  if (!grant) {
    // Grant not found or expired
    return oauthError(
      c,
      "invalid_grant",
      "Authorization code not found or expired",
    );
  }

  // Verify the authorization code hasn't been used
  if (!grant.authCodeId) {
    // Code already exchanged - RFC 6749 Section 4.1.2 requires this check
    return oauthError(
      c,
      "invalid_grant",
      "Authorization code has already been used",
    );
  }

  // Verify the code hash matches
  const codeHash = await hashSecret(code);
  if (codeHash !== grant.authCodeId) {
    return oauthError(c, "invalid_grant", "Invalid authorization code");
  }

  // Verify client_id matches the grant
  if (grant.clientId !== client.clientId) {
    return oauthError(c, "invalid_grant", "Client ID mismatch");
  }

  // RFC 6749 Section 4.1.3: If redirect_uri was included in the authorization request,
  // the value MUST be identical to the value included in the authorization request.
  if (grant.redirectUri) {
    if (!redirectUri) {
      return oauthError(
        c,
        "invalid_grant",
        "Missing required parameter: redirect_uri",
      );
    }
    if (redirectUri !== grant.redirectUri) {
      return oauthError(c, "invalid_grant", "redirect_uri mismatch");
    }
  }

  // RFC 7636 Section 4.6: Verify PKCE code_verifier
  if (grant.codeChallenge) {
    if (!codeVerifier) {
      return oauthError(
        c,
        "invalid_grant",
        "Missing required parameter: code_verifier (PKCE)",
      );
    }

    const method = grant.codeChallengeMethod || "plain";
    const valid = await verifyCodeChallenge(
      codeVerifier,
      grant.codeChallenge,
      method,
    );
    if (!valid) {
      return oauthError(c, "invalid_grant", "Invalid code_verifier");
    }
  }

  // Store the wrapped key before consuming the auth code
  // This is needed to unwrap the encryption key later
  const authCodeWrappedKey = grant.authCodeWrappedKey!;

  // IMPORTANT: Atomically consume the authorization code BEFORE issuing tokens
  // RFC 6749 Section 4.1.2: Code MUST NOT be used more than once
  // By clearing the auth code data before issuing tokens, we prevent TOCTOU race
  // conditions where two concurrent requests could both exchange the same code.
  const consumedGrant: Grant = {
    ...grant,
    authCodeId: undefined,
    authCodeWrappedKey: undefined,
    codeChallenge: undefined,
    codeChallengeMethod: undefined,
  };
  await storage.saveGrant(consumedGrant);

  // Unwrap the encryption key using the authorization code
  let encryptionKey: CryptoKey;
  try {
    encryptionKey = await unwrapKeyWithToken(code, authCodeWrappedKey);
  } catch {
    return oauthError(
      c,
      "invalid_grant",
      "Failed to process authorization code",
    );
  }

  // Generate new tokens
  const accessToken = generateToken(userId, grantId);
  const refreshToken = generateToken(userId, grantId);
  const accessTokenId = await generateTokenId(accessToken);
  const refreshTokenId = await generateTokenId(refreshToken);

  // Wrap encryption key with the new tokens
  const accessTokenWrappedKey = await wrapKeyWithToken(
    accessToken,
    encryptionKey,
  );
  const refreshTokenWrappedKey = await wrapKeyWithToken(
    refreshToken,
    encryptionKey,
  );

  const now = Math.floor(Date.now() / 1000);

  // Create access token record
  const accessTokenData: Token = {
    id: accessTokenId,
    grantId: grant.id,
    userId: grant.userId,
    createdAt: now,
    expiresAt: now + DEFAULT_ACCESS_TOKEN_TTL,
    audience: grant.resource,
    wrappedEncryptionKey: accessTokenWrappedKey,
    grant: {
      clientId: grant.clientId,
      scope: grant.scope,
      encryptedProps: grant.encryptedProps,
    },
  };

  // Create refresh token record
  const refreshTokenData: Token = {
    id: refreshTokenId,
    grantId: grant.id,
    userId: grant.userId,
    createdAt: now,
    expiresAt: now + DEFAULT_REFRESH_TOKEN_TTL,
    audience: grant.resource,
    wrappedEncryptionKey: refreshTokenWrappedKey,
    grant: {
      clientId: grant.clientId,
      scope: grant.scope,
      encryptedProps: grant.encryptedProps,
    },
  };

  // Save tokens
  await storage.saveToken(accessTokenData, DEFAULT_ACCESS_TOKEN_TTL);
  await storage.saveToken(refreshTokenData, DEFAULT_REFRESH_TOKEN_TTL);

  // Return token response (RFC 6749 Section 5.1)
  const response: TokenResponse = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: DEFAULT_ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope: grant.scope.join(" "),
  };

  return c.json(response, 200, {
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
}

// =============================================================================
// Refresh Token Grant (RFC 6749 Section 6)
// =============================================================================

/**
 * Handle refresh_token grant type.
 *
 * Issues a new access token (and optionally new refresh token) using
 * a valid refresh token. Also handles upstream Sentry token refresh
 * if the Sentry access token is expired or near expiry.
 *
 * @see RFC 6749 Section 6
 */
async function handleRefreshTokenGrant(
  c: Context<{ Bindings: Env }>,
  body: Record<string, string | undefined>,
  storage: OAuthStorage,
  client: ClientInfo,
): Promise<Response> {
  const refreshToken = body.refresh_token;

  // RFC 6749 Section 6: refresh_token is REQUIRED
  if (!refreshToken) {
    return oauthError(
      c,
      "invalid_request",
      "Missing required parameter: refresh_token",
    );
  }

  // Parse refresh token
  const parsed = parseToken(refreshToken);
  if (!parsed) {
    return oauthError(c, "invalid_grant", "Invalid refresh token format");
  }

  const { userId, grantId } = parsed;

  // Look up the refresh token
  const refreshTokenId = await generateTokenId(refreshToken);
  const tokenData = await storage.getToken(userId, grantId, refreshTokenId);

  // Check for grace period (token rotation)
  // If the current token wasn't found, check if this is the previous refresh token
  if (!tokenData) {
    // Look up all tokens for this grant to find one with this as previousRefreshTokenId
    // For simplicity, we'll just fail here. In production, you'd want to handle
    // the grace period properly by storing the previous token ID.
    return oauthError(c, "invalid_grant", "Refresh token not found or expired");
  }

  // Verify token hasn't expired
  const now = Math.floor(Date.now() / 1000);
  if (tokenData.expiresAt < now) {
    return oauthError(c, "invalid_grant", "Refresh token has expired");
  }

  // Verify client_id matches the token's grant
  if (tokenData.grant.clientId !== client.clientId) {
    return oauthError(c, "invalid_grant", "Client ID mismatch");
  }

  // Unwrap encryption key using refresh token
  let encryptionKey: CryptoKey;
  try {
    encryptionKey = await unwrapKeyWithToken(
      refreshToken,
      tokenData.wrappedEncryptionKey,
    );
  } catch {
    return oauthError(c, "invalid_grant", "Failed to process refresh token");
  }

  // Decrypt props to check if upstream refresh is needed
  // encryptedProps is stored as JSON containing { ciphertext, iv }
  let props: WorkerProps;
  try {
    const encrypted = JSON.parse(tokenData.grant.encryptedProps);
    props = await decryptProps(encrypted, encryptionKey);
  } catch {
    // Fallback: try fetching from the grant directly
    const grant = await storage.getGrant(userId, grantId);
    if (!grant) {
      return oauthError(c, "invalid_grant", "Grant not found");
    }
    try {
      const encrypted = JSON.parse(grant.encryptedProps);
      props = await decryptProps(encrypted, encryptionKey);
    } catch {
      return oauthError(c, "server_error", "Failed to decrypt props", 500);
    }
  }

  // Check if upstream Sentry token needs refresh
  let updatedProps = props;
  let accessTokenTTL = DEFAULT_ACCESS_TOKEN_TTL;

  if (props.refreshToken) {
    const maybeExpiresAt = props.accessTokenExpiresAt;

    if (maybeExpiresAt && Number.isFinite(maybeExpiresAt)) {
      const remainingMs = maybeExpiresAt - Date.now();

      if (remainingMs > UPSTREAM_REFRESH_SAFETY_WINDOW_MS) {
        // Upstream token still valid, use remaining TTL
        accessTokenTTL = Math.min(
          Math.floor(remainingMs / 1000),
          DEFAULT_ACCESS_TOKEN_TTL,
        );
      } else {
        // Need to refresh upstream token
        const refreshResult = await refreshUpstreamToken(c.env, props);
        if (refreshResult) {
          updatedProps = refreshResult.props;
          accessTokenTTL = refreshResult.expiresIn;
        }
      }
    } else {
      // No expiry info, try to refresh upstream
      const refreshResult = await refreshUpstreamToken(c.env, props);
      if (refreshResult) {
        updatedProps = refreshResult.props;
        accessTokenTTL = refreshResult.expiresIn;
      }
    }
  }

  // Generate new tokens
  const newAccessToken = generateToken(userId, grantId);
  const newRefreshToken = generateToken(userId, grantId);
  const newAccessTokenId = await generateTokenId(newAccessToken);
  const newRefreshTokenId = await generateTokenId(newRefreshToken);

  // If props changed, re-encrypt with new key
  let encryptedProps = tokenData.grant.encryptedProps;
  let newEncryptionKey = encryptionKey;

  if (updatedProps !== props) {
    // Props changed, need to re-encrypt
    newEncryptionKey = await generateEncryptionKey();
    const encrypted = await encryptProps(updatedProps, newEncryptionKey);
    encryptedProps = JSON.stringify(encrypted);
  }

  // Wrap encryption key with new tokens
  const newAccessTokenWrappedKey = await wrapKeyWithToken(
    newAccessToken,
    newEncryptionKey,
  );
  const newRefreshTokenWrappedKey = await wrapKeyWithToken(
    newRefreshToken,
    newEncryptionKey,
  );

  // Create new token records
  const newAccessTokenData: Token = {
    id: newAccessTokenId,
    grantId: grantId,
    userId: userId,
    createdAt: now,
    expiresAt: now + accessTokenTTL,
    audience: tokenData.audience,
    wrappedEncryptionKey: newAccessTokenWrappedKey,
    grant: {
      clientId: tokenData.grant.clientId,
      scope: tokenData.grant.scope,
      encryptedProps: encryptedProps,
    },
  };

  const newRefreshTokenData: Token = {
    id: newRefreshTokenId,
    grantId: grantId,
    userId: userId,
    createdAt: now,
    expiresAt: now + DEFAULT_REFRESH_TOKEN_TTL,
    audience: tokenData.audience,
    wrappedEncryptionKey: newRefreshTokenWrappedKey,
    grant: {
      clientId: tokenData.grant.clientId,
      scope: tokenData.grant.scope,
      encryptedProps: encryptedProps,
    },
    // Track previous refresh token for grace period
    previousRefreshTokenId: refreshTokenId,
  };

  // Save new tokens
  await storage.saveToken(newAccessTokenData, accessTokenTTL);
  await storage.saveToken(newRefreshTokenData, DEFAULT_REFRESH_TOKEN_TTL);

  // Keep old refresh token valid for grace period
  // (Already stored, TTL handles expiration)

  // Update grant with new encrypted props if changed
  if (updatedProps !== props) {
    const grant = await storage.getGrant(userId, grantId);
    if (grant) {
      await storage.saveGrant({
        ...grant,
        encryptedProps: encryptedProps,
      });
    }
  }

  // Return token response
  const response: TokenResponse = {
    access_token: newAccessToken,
    token_type: "bearer",
    expires_in: accessTokenTTL,
    refresh_token: newRefreshToken,
    scope: tokenData.grant.scope.join(" "),
  };

  return c.json(response, 200, {
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
}

// =============================================================================
// Upstream Token Refresh
// =============================================================================

/**
 * Refresh the upstream Sentry access token.
 *
 * @param env - Environment with Sentry credentials
 * @param props - Current props with refresh token
 * @returns Updated props and expiry, or null if refresh failed
 */
async function refreshUpstreamToken(
  env: Env,
  props: WorkerProps,
): Promise<{ props: WorkerProps; expiresIn: number } | null> {
  if (!props.refreshToken) {
    return null;
  }

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

  if (errorResponse || !tokenResponse) {
    // Don't log here - refreshAccessToken already logs appropriately
    // (logWarn for 4xx user errors, logIssue for 5xx system errors)
    return null;
  }

  if (!tokenResponse.refresh_token) {
    // Use logWarn not logIssue - missing refresh_token is likely an upstream
    // config/contract issue, not a system failure requiring alerting
    logWarn("[oauth] Upstream refresh response missing refresh_token", {
      loggerScope: ["cloudflare", "oauth", "token"],
    });
    return null;
  }

  return {
    props: {
      ...props,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      accessTokenExpiresAt: Date.now() + tokenResponse.expires_in * 1000,
    },
    expiresIn: tokenResponse.expires_in,
  };
}

// =============================================================================
// Error Responses
// =============================================================================

/**
 * Create an OAuth error response.
 *
 * @see RFC 6749 Section 5.2 - Error Response
 */
function oauthError(
  c: Context<{ Bindings: Env }>,
  error: TokenErrorResponse["error"] | "server_error",
  description: string,
  status: 400 | 401 | 500 = 400,
): Response {
  if (status === 500) {
    logIssue(`[oauth] Token endpoint error: ${description}`, {
      loggerScope: ["cloudflare", "oauth", "token"],
    });
  }

  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  };

  // RFC 6749 Section 5.2: invalid_client SHOULD return 401 with WWW-Authenticate header
  if (error === "invalid_client" && status === 401) {
    headers["WWW-Authenticate"] = 'Basic realm="token"';
  }

  return c.json({ error, error_description: description }, status, headers);
}

export default tokenRoute;
