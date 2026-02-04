/**
 * OAuth Bearer Token Authentication Middleware
 *
 * Validates Bearer tokens on protected routes (/mcp/*) and injects
 * decrypted props into the request context.
 *
 * Authentication flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Parse token to extract userId, grantId
 * 3. Look up token in storage
 * 4. Verify token hasn't expired
 * 5. Unwrap encryption key using token
 * 6. Decrypt props (Sentry tokens)
 * 7. Inject props into context for downstream handlers
 *
 * @see RFC 6750 - OAuth 2.0 Bearer Token Usage
 * @see RFC 6750 Section 2.1 - Authorization Request Header Field
 */

import { logIssue } from "@sentry/mcp-core/telem/logging";
import type { Context, MiddlewareHandler } from "hono";
import type { Env, WorkerProps } from "../../types";
import {
  decryptProps,
  generateTokenId,
  parseToken,
  unwrapKeyWithToken,
} from "../crypto";
import type { OAuthStorage } from "../storage";

// =============================================================================
// Context Extensions
// =============================================================================

/**
 * Extended context variables set by auth middleware.
 */
export interface AuthContext {
  /** Decrypted OAuth props (Sentry tokens) */
  props: WorkerProps;
  /** User ID from the token */
  userId: string;
  /** Grant ID from the token */
  grantId: string;
  /** Granted scopes */
  scope: string[];
  /** Client ID that obtained the token */
  clientId: string;
}

// Declare module augmentation for Hono context
declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    oauthStorage: OAuthStorage;
  }
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Bearer token authentication middleware.
 *
 * Validates the access token and injects auth context for downstream handlers.
 *
 * Usage:
 * ```typescript
 * app.use('/mcp/*', bearerAuth());
 * ```
 *
 * After middleware runs, access auth context via:
 * ```typescript
 * const { props, userId, scope } = c.get('auth');
 * ```
 *
 * @see RFC 6750 Section 2.1 - Authorization Request Header Field
 */
export function bearerAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    // Get storage from context (must be set earlier in middleware chain)
    const storage = c.get("oauthStorage") as OAuthStorage | undefined;
    if (!storage) {
      logIssue("[oauth] OAuth storage not configured", {
        loggerScope: ["cloudflare", "oauth", "auth"],
      });
      return unauthorizedResponse(
        c,
        "server_error",
        "OAuth storage not configured",
      );
    }

    // RFC 6750 Section 2.1: Extract token from Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return unauthorizedResponse(
        c,
        "invalid_request",
        "Missing Authorization header",
      );
    }

    // RFC 6750 Section 2.1: Must be "Bearer" scheme
    if (!authHeader.startsWith("Bearer ")) {
      return unauthorizedResponse(
        c,
        "invalid_request",
        "Authorization header must use Bearer scheme",
      );
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix
    if (!token) {
      return unauthorizedResponse(c, "invalid_token", "Missing access token");
    }

    // Validate the token
    const result = await validateAccessToken(token, storage);

    if (!result.valid) {
      return unauthorizedResponse(
        c,
        "invalid_token",
        result.error || "Invalid access token",
      );
    }

    // Set auth context for downstream handlers
    c.set("auth", {
      props: result.props!,
      userId: result.grant!.userId,
      grantId: result.grant!.grantId,
      scope: result.grant!.scope,
      clientId: result.grant!.clientId,
    });

    await next();
  };
}

// =============================================================================
// Token Validation
// =============================================================================

interface TokenValidationSuccess {
  valid: true;
  props: WorkerProps;
  grant: { clientId: string; userId: string; grantId: string; scope: string[] };
}

interface TokenValidationFailure {
  valid: false;
  error: string;
}

type TokenValidationResult = TokenValidationSuccess | TokenValidationFailure;

/**
 * Validate an access token.
 */
async function validateAccessToken(
  token: string,
  storage: OAuthStorage,
): Promise<TokenValidationResult> {
  // Parse token to extract userId and grantId
  const parsed = parseToken(token);
  if (!parsed) {
    return { valid: false, error: "Invalid token format" };
  }

  const { userId, grantId } = parsed;

  // Generate token ID (hash) for lookup
  const tokenId = await generateTokenId(token);

  // Look up token in storage
  const tokenData = await storage.getToken(userId, grantId, tokenId);
  if (!tokenData) {
    return { valid: false, error: "Token not found or expired" };
  }

  // Check if token has expired
  const now = Math.floor(Date.now() / 1000);
  if (tokenData.expiresAt < now) {
    return { valid: false, error: "Token has expired" };
  }

  // Unwrap the encryption key using the token
  let encryptionKey: CryptoKey;
  try {
    encryptionKey = await unwrapKeyWithToken(
      token,
      tokenData.wrappedEncryptionKey,
    );
  } catch {
    return { valid: false, error: "Failed to process token" };
  }

  // Decrypt the props
  let props: WorkerProps;
  try {
    // The encryptedProps is stored as JSON with ciphertext and iv
    const encrypted = JSON.parse(tokenData.grant.encryptedProps);
    props = await decryptProps(encrypted, encryptionKey);
  } catch {
    return { valid: false, error: "Failed to decrypt token data" };
  }

  return {
    valid: true,
    props,
    grant: {
      clientId: tokenData.grant.clientId,
      userId: tokenData.userId,
      grantId: tokenData.grantId,
      scope: tokenData.grant.scope,
    },
  } satisfies TokenValidationSuccess;
}

// =============================================================================
// Error Responses
// =============================================================================

type AuthErrorCode =
  | "invalid_request"
  | "invalid_token"
  | "insufficient_scope"
  | "server_error";

/**
 * Create a 401 Unauthorized response with WWW-Authenticate header.
 *
 * @see RFC 6750 Section 3 - The WWW-Authenticate Response Header Field
 */
function unauthorizedResponse(
  c: Context<{ Bindings: Env }>,
  error: AuthErrorCode,
  description: string,
): Response {
  const wwwAuthenticate = `Bearer realm="sentry-mcp", error="${error}", error_description="${description}"`;
  const status = error === "server_error" ? 500 : 401;

  return c.json({ error, error_description: description }, status, {
    "WWW-Authenticate": wwwAuthenticate,
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
}

/**
 * Create a 403 Forbidden response for insufficient scope.
 *
 * @see RFC 6750 Section 3.1 - Error Codes
 */
export function insufficientScopeResponse(
  c: Context<{ Bindings: Env }>,
  requiredScope: string,
): Response {
  const description = `The request requires scope: ${requiredScope}`;
  const wwwAuthenticate = `Bearer realm="sentry-mcp", error="insufficient_scope", error_description="${description}", scope="${requiredScope}"`;

  return c.json(
    { error: "insufficient_scope", error_description: description },
    403,
    {
      "WWW-Authenticate": wwwAuthenticate,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  );
}

/**
 * Middleware to require specific scope(s).
 *
 * Use after bearerAuth() to enforce scope requirements.
 *
 * Usage:
 * ```typescript
 * app.use('/mcp/admin/*', bearerAuth(), requireScope('org:admin'));
 * ```
 */
export function requireScope(
  ...requiredScopes: string[]
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      return unauthorizedResponse(
        c,
        "invalid_token",
        "Authentication required",
      );
    }

    // Check if all required scopes are present
    const grantedScopes = new Set(auth.scope);
    for (const required of requiredScopes) {
      if (!grantedScopes.has(required)) {
        return insufficientScopeResponse(c, required);
      }
    }

    await next();
  };
}
