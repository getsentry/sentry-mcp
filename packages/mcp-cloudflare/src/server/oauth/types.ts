/**
 * OAuth 2.0 Type Definitions
 *
 * Types for the Sentry MCP OAuth provider implementation.
 * References to OAuth specifications are included where applicable.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749 - OAuth 2.0
 * @see https://datatracker.ietf.org/doc/html/rfc7591 - Dynamic Client Registration
 * @see https://datatracker.ietf.org/doc/html/rfc7636 - PKCE
 * @see https://datatracker.ietf.org/doc/html/rfc8707 - Resource Indicators
 */

import type { WorkerProps } from "../types";
export type { WorkerProps };

// =============================================================================
// Client Types (RFC 7591 - Dynamic Client Registration)
// =============================================================================

/**
 * Registered OAuth client information.
 *
 * @see RFC 7591 Section 2 - Client Metadata
 * @see RFC 7591 Section 3.2.1 - Client Information Response
 */
export interface ClientInfo {
  /** Unique client identifier issued during registration */
  clientId: string;

  /**
   * Client secret (hashed) for confidential clients.
   * Only present for clients with tokenEndpointAuthMethod !== 'none'.
   *
   * @see RFC 6749 Section 2.3.1 - Client Password
   */
  clientSecret?: string;

  /**
   * Array of allowed redirect URIs.
   * Authorization requests must use one of these URIs exactly.
   *
   * @see RFC 6749 Section 3.1.2.2 - Registration Requirements
   */
  redirectUris: string[];

  /** Human-readable client name for display in authorization UI */
  clientName?: string;

  /** URL of the client's home page */
  clientUri?: string;

  /** URL of the client's logo image */
  logoUri?: string;

  /** URL of the client's privacy policy */
  policyUri?: string;

  /** URL of the client's terms of service */
  tosUri?: string;

  /** Contact email addresses for the client */
  contacts?: string[];

  /**
   * Authentication method for the token endpoint.
   *
   * - 'none': Public client, no authentication (RFC 6749 Section 2.1)
   * - 'client_secret_basic': HTTP Basic auth (RFC 6749 Section 2.3.1)
   * - 'client_secret_post': Credentials in request body (RFC 6749 Section 2.3.1)
   *
   * @see RFC 7591 Section 2 - token_endpoint_auth_method
   */
  tokenEndpointAuthMethod:
    | "none"
    | "client_secret_basic"
    | "client_secret_post";

  /**
   * Grant types the client is allowed to use.
   *
   * @see RFC 7591 Section 2 - grant_types
   */
  grantTypes: string[];

  /**
   * Response types the client is allowed to request.
   *
   * @see RFC 7591 Section 2 - response_types
   */
  responseTypes: string[];

  /** Unix timestamp when the client was registered */
  registrationDate: number;
}

/**
 * Client registration request body.
 *
 * @see RFC 7591 Section 2 - Client Metadata
 */
export interface ClientRegistrationRequest {
  /** Array of redirect URIs (required) */
  redirect_uris: string[];

  /** Human-readable client name */
  client_name?: string;

  /** URL of the client's home page */
  client_uri?: string;

  /** URL of the client's logo */
  logo_uri?: string;

  /** URL of privacy policy */
  policy_uri?: string;

  /** URL of terms of service */
  tos_uri?: string;

  /** Contact emails */
  contacts?: string[];

  /** Token endpoint authentication method */
  token_endpoint_auth_method?:
    | "none"
    | "client_secret_basic"
    | "client_secret_post";

  /** Allowed grant types */
  grant_types?: string[];

  /** Allowed response types */
  response_types?: string[];
}

/**
 * Client registration response.
 *
 * @see RFC 7591 Section 3.2.1 - Client Information Response
 */
export interface ClientRegistrationResponse {
  /** Issued client identifier */
  client_id: string;

  /**
   * Client secret (unhashed, returned only once).
   * Only present for confidential clients.
   */
  client_secret?: string;

  /** Unix timestamp when client_id was issued */
  client_id_issued_at: number;

  /**
   * Unix timestamp when client_secret expires.
   * 0 means it does not expire.
   */
  client_secret_expires_at?: number;

  // Echo back registration metadata
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
}

// =============================================================================
// Authorization Request Types (RFC 6749 Section 4.1.1)
// =============================================================================

/**
 * Parsed authorization request parameters.
 *
 * @see RFC 6749 Section 4.1.1 - Authorization Request
 * @see RFC 7636 Section 4.3 - Code Challenge
 * @see RFC 8707 Section 2 - Resource Parameter
 */
export interface AuthRequest {
  /**
   * Must be 'code' for authorization code flow.
   *
   * @see RFC 6749 Section 4.1.1 - response_type
   */
  responseType: string;

  /**
   * Client identifier.
   *
   * @see RFC 6749 Section 4.1.1 - client_id
   */
  clientId: string;

  /**
   * URI to redirect back to after authorization.
   *
   * @see RFC 6749 Section 4.1.1 - redirect_uri
   */
  redirectUri: string;

  /**
   * Requested scope as array of scope strings.
   *
   * @see RFC 6749 Section 4.1.1 - scope
   */
  scope: string[];

  /**
   * Opaque value for maintaining state between request and callback.
   * Used for CSRF protection.
   *
   * @see RFC 6749 Section 4.1.1 - state
   */
  state: string;

  /**
   * PKCE code challenge.
   *
   * @see RFC 7636 Section 4.2 - code_challenge
   */
  codeChallenge?: string;

  /**
   * PKCE challenge method: 'plain' or 'S256'.
   *
   * @see RFC 7636 Section 4.2 - code_challenge_method
   */
  codeChallengeMethod?: string;

  /**
   * Resource indicator(s) for audience restriction.
   * Can be a single URI or array of URIs.
   *
   * @see RFC 8707 Section 2 - resource
   */
  resource?: string | string[];
}

// =============================================================================
// Grant Types
// =============================================================================

/**
 * An authorization grant representing user consent.
 *
 * Grants are created when a user approves an authorization request.
 * They store the encrypted props (Sentry tokens) and track authorization codes.
 */
export interface Grant {
  /** Unique grant identifier */
  id: string;

  /** Client that received this grant */
  clientId: string;

  /** User who authorized this grant (Sentry user ID) */
  userId: string;

  /** Scopes granted to the client */
  scope: string[];

  /** Optional metadata (e.g., user display name) */
  metadata?: Record<string, unknown>;

  /**
   * Encrypted WorkerProps containing Sentry tokens.
   * Encrypted with AES-256-GCM, key wrapped with token/code.
   */
  encryptedProps: string;

  /** Unix timestamp when grant was created */
  createdAt: number;

  /** Unix timestamp when grant expires (optional) */
  expiresAt?: number;

  // --- Authorization Code Fields ---
  // Present only before the code has been exchanged

  /**
   * Hash of the authorization code.
   * Cleared after code is exchanged for tokens.
   */
  authCodeId?: string;

  /**
   * Encryption key wrapped with the authorization code.
   * Allows decrypting props only with the valid code.
   */
  authCodeWrappedKey?: string;

  /**
   * PKCE code challenge from the authorization request.
   *
   * @see RFC 7636 Section 4.2
   */
  codeChallenge?: string;

  /**
   * PKCE challenge method: 'plain' or 'S256'.
   *
   * @see RFC 7636 Section 4.2
   */
  codeChallengeMethod?: string;

  /**
   * Resource indicator from the authorization request.
   *
   * @see RFC 8707 Section 2
   */
  resource?: string | string[];

  /**
   * Redirect URI from the authorization request.
   * Must be verified at token exchange per RFC 6749 Section 4.1.3.
   *
   * @see RFC 6749 Section 4.1.3
   */
  redirectUri?: string;
}

/**
 * Summary of a grant for listing (excludes sensitive data).
 */
export interface GrantSummary {
  id: string;
  clientId: string;
  userId: string;
  scope: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  expiresAt?: number;
}

// =============================================================================
// Token Types (RFC 6749 Section 5.1)
// =============================================================================

/**
 * An issued access or refresh token.
 *
 * Tokens are stored with denormalized grant information to allow
 * validation without additional lookups.
 */
export interface Token {
  /**
   * Token identifier (hash of the full token string).
   * Used as part of the storage key.
   */
  id: string;

  /** Grant this token belongs to */
  grantId: string;

  /** User who owns this token */
  userId: string;

  /** Unix timestamp when token was issued */
  createdAt: number;

  /** Unix timestamp when token expires */
  expiresAt: number;

  /**
   * Token audience (from resource parameter).
   *
   * @see RFC 8707 Section 2
   */
  audience?: string | string[];

  /**
   * Encryption key wrapped with this token.
   * Allows decrypting props only with the valid token.
   */
  wrappedEncryptionKey: string;

  /** Denormalized grant data for validation */
  grant: {
    clientId: string;
    scope: string[];
    encryptedProps: string;
  };

  /**
   * Previous refresh token ID (for rotation grace period).
   * If set, the previous refresh token is still valid.
   */
  previousRefreshTokenId?: string;
}

/**
 * Token request for authorization_code grant.
 *
 * @see RFC 6749 Section 4.1.3 - Access Token Request
 */
export interface AuthorizationCodeTokenRequest {
  grant_type: "authorization_code";
  code: string;
  redirect_uri: string;
  client_id: string;
  /** PKCE code verifier (RFC 7636 Section 4.5) */
  code_verifier?: string;
}

/**
 * Token request for refresh_token grant.
 *
 * @see RFC 6749 Section 6 - Refreshing an Access Token
 */
export interface RefreshTokenRequest {
  grant_type: "refresh_token";
  refresh_token: string;
  client_id?: string;
  scope?: string;
}

/**
 * Successful token response.
 *
 * @see RFC 6749 Section 5.1 - Successful Response
 */
export interface TokenResponse {
  /** The access token string */
  access_token: string;

  /** Token type, always 'bearer' */
  token_type: "bearer";

  /** Lifetime in seconds */
  expires_in: number;

  /** Refresh token for obtaining new access tokens */
  refresh_token?: string;

  /** Granted scope (if different from requested) */
  scope?: string;
}

/**
 * Token error response.
 *
 * @see RFC 6749 Section 5.2 - Error Response
 */
export interface TokenErrorResponse {
  /**
   * Error code.
   *
   * @see RFC 6749 Section 5.2 - error
   */
  error:
    | "invalid_request"
    | "invalid_client"
    | "invalid_grant"
    | "unauthorized_client"
    | "unsupported_grant_type"
    | "invalid_scope";

  /** Human-readable error description */
  error_description?: string;

  /** URI with more information about the error */
  error_uri?: string;
}

// =============================================================================
// Authorization Server Metadata (RFC 8414)
// =============================================================================

/**
 * OAuth 2.0 Authorization Server Metadata.
 *
 * @see RFC 8414 Section 2 - Authorization Server Metadata
 */
export interface AuthorizationServerMetadata {
  /** Authorization server identifier (URL) */
  issuer: string;

  /** URL of the authorization endpoint */
  authorization_endpoint: string;

  /** URL of the token endpoint */
  token_endpoint: string;

  /** URL of the client registration endpoint (RFC 7591) */
  registration_endpoint?: string;

  /** Supported scopes */
  scopes_supported?: string[];

  /** Supported response types */
  response_types_supported: string[];

  /** Supported grant types */
  grant_types_supported?: string[];

  /** Supported token endpoint authentication methods */
  token_endpoint_auth_methods_supported?: string[];

  /** Supported PKCE code challenge methods (RFC 7636) */
  code_challenge_methods_supported?: string[];

  /** URL of the token revocation endpoint (RFC 7009) */
  revocation_endpoint?: string;

  /** Supported revocation authentication methods */
  revocation_endpoint_auth_methods_supported?: string[];
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Options for completing an authorization request.
 * Used by the callback handler after user approves.
 */
export interface CompleteAuthorizationOptions {
  /** The original authorization request */
  request: AuthRequest;

  /** User ID (from Sentry upstream) */
  userId: string;

  /** Granted scopes */
  scope: string[];

  /** Props to encrypt (Sentry tokens) */
  props: WorkerProps;

  /** Optional metadata to store with grant */
  metadata?: Record<string, unknown>;
}

/**
 * Result of completing authorization.
 */
export interface CompleteAuthorizationResult {
  /** URL to redirect the user to (includes auth code) */
  redirectTo: string;
}

/**
 * Pagination options for list operations.
 */
export interface ListOptions {
  limit?: number;
  cursor?: string;
}

/**
 * Paginated list result.
 */
export interface ListResult<T> {
  items: T[];
  cursor?: string;
}

/**
 * Parsed token components.
 * Tokens have format: {userId}:{grantId}:{secret}
 */
export interface ParsedToken {
  userId: string;
  grantId: string;
  secret: string;
}

/**
 * Result of validating an access token.
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;

  /** Error message if invalid */
  error?: string;

  /** Decrypted props if valid */
  props?: WorkerProps;

  /** Grant information if valid */
  grant?: {
    clientId: string;
    userId: string;
    scope: string[];
  };
}

/**
 * Options for the token exchange callback.
 *
 * Used when refreshing MCP access tokens to also refresh
 * the underlying Sentry access token if needed.
 */
export interface TokenExchangeCallbackOptions {
  /** Grant type being processed */
  grantType: "authorization_code" | "refresh_token";

  /** OAuth client ID */
  clientId: string;

  /** User ID */
  userId: string;

  /** Granted scopes */
  scope: string[];

  /** Current props containing Sentry tokens */
  props: WorkerProps;
}

/**
 * Result of the token exchange callback.
 */
export interface TokenExchangeCallbackResult {
  /** Updated props with new tokens */
  newProps: WorkerProps;

  /** TTL for the new access token in seconds */
  accessTokenTTL: number;
}
