/**
 * OAuth 2.1 Provider Type Definitions
 * 
 * Common types shared across OAuth handlers and modules.
 * 
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10 - OAuth 2.1 Specification
 * @see https://datatracker.ietf.org/doc/html/rfc6749 - OAuth 2.0 Core Specification
 * @see https://datatracker.ietf.org/doc/html/rfc7636 - PKCE Extension
 */

/**
 * Storage interface for OAuth 2.1 provider
 * Matches Cloudflare KV API for compatibility
 */
export interface Storage {
  get(key: string): Promise<string | null>;
  get<T>(key: string, options: { type: 'json' }): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>;
}

/**
 * Options for token exchange callback
 */
export interface TokenExchangeCallbackOptions {
  /** The type of grant being processed */
  grantType: 'authorization_code' | 'refresh_token';
  /** Client that received this grant */
  clientId: string;
  /** User who authorized this grant */
  userId: string;
  /** List of scopes that were granted */
  scope: string[];
  /** Application-specific context currently associated with this grant */
  context: any;
}

/**
 * Result of token exchange callback
 */
export interface TokenExchangeCallbackResult {
  /** New context to replace the context stored in the grant */
  newContext?: any;
  /** Override the default access token TTL (in seconds) */
  accessTokenTTL?: number;
}

/**
 * Configuration for OAuth 2.1 provider
 */
export interface OAuth21Config {
  /** Storage backend for persisting OAuth data */
  storage: Storage;
  /** OAuth issuer URL (should match deployment URL) */
  issuer: string;
  /** List of supported OAuth scopes */
  scopesSupported: string[];
  /** Enable strict OAuth 2.1 compliance (default: true) */
  strictMode?: boolean;
  /** Maximum authorization lifetime in milliseconds (default: 1 year) */
  maxAuthorizationLifetime?: number;
  
  // OAuth Proxy Configuration
  /** Callback for updating context during token exchange/refresh */
  tokenExchangeCallback?: (
    options: TokenExchangeCallbackOptions
  ) => Promise<TokenExchangeCallbackResult | void> | TokenExchangeCallbackResult | void;
}

/**
 * OAuth client registration
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-2 - Client Types
 * @see https://datatracker.ietf.org/doc/html/rfc7591 - Dynamic Client Registration
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-2 - OAuth 2.1 Client Types
 */
export interface Client {
  /** 
   * Unique client identifier
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-2.2 - Client Identifier
   */
  id: string;
  /** 
   * Client secret (undefined for public clients)
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-2.3.1 - Client Password
   */
  secret?: string;
  /** 
   * Allowed redirect URIs - must be exact match
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.1.2 - Redirection Endpoint
   * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-2.3.1 - Exact matching requirement
   */
  redirectUris: string[];
  /** Client display name */
  name: string;
}

/**
 * OAuth authorization grant
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-1.3 - Authorization Grant
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2 - Authorization Response
 * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.3 - PKCE Authorization Request
 */
export interface Grant {
  /** Unique grant identifier */
  id: string;
  /** Associated client ID */
  clientId: string;
  /** Authenticated user ID */
  userId: string;
  /** 
   * Granted scope
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.3 - Access Token Scope
   */
  scope: string;
  /** 
   * Authorization code - single use, 10 minute maximum lifetime
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2 - Authorization Code
   * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Authorization code lifetime
   */
  code?: string;
  /** 
   * Redirect URI used in authorization - must match exactly on token exchange
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3 - Redirect URI validation
   */
  redirectUri?: string;
  /** 
   * PKCE code challenge
   * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.3 - Code Challenge
   */
  codeChallenge?: string;
  /** 
   * PKCE challenge method
   * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.2 - Code Challenge Method
   */
  codeChallengeMethod?: 'S256' | 'plain';
  /** Grant expiration timestamp */
  expiresAt: number;
  /** 
   * Track if code has been exchanged (OAuth 2.1 reuse detection)
   * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Authorization code reuse
   */
  exchanged?: boolean;
  /** Original grant creation time for lifetime tracking */
  createdAt: number;
  /** Application-specific context (e.g., upstream tokens) - unencrypted in memory */
  context?: any;
  /** Encrypted context for storage */
  encryptedContext?: string;
  /** Encryption key wrapped with authorization code */
  authCodeWrappedKey?: string;
  /** Initialization vector for AES-GCM encryption */
  iv?: string;
}

/**
 * Access token data
 */
export interface TokenData {
  userId: string;
  clientId: string;
  scope: string;
  expiresAt: number;
  grantId?: string;
  /** Encrypted context (upstream tokens) */
  encryptedContext?: string;
  /** Wrapped encryption key for this token */
  wrappedKey?: string;
  /** Initialization vector */
  iv?: string;
}

/**
 * Refresh token data
 */
export interface RefreshTokenData {
  userId: string;
  clientId: string;
  scope: string;
  grantId?: string;
  expiresAt?: number;
  createdAt: number;
  previousTokenHash?: string;  // Hash of previous refresh token for grace period
  isRotated?: boolean;         // Whether this token has been rotated (new token issued)
  /** Encrypted context (upstream tokens) */
  encryptedContext?: string;
  /** Wrapped encryption key for this token */
  wrappedKey?: string;
  /** Initialization vector */
  iv?: string;
}

/**
 * CSRF token data
 */
export interface CSRFData {
  clientId: string;
  redirectUri: string;
  expiresAt: number;
}

/**
 * Token response format
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.1 - Successful Response
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.4 - Access Token Response
 */
export interface TokenResponse {
  /** 
   * The access token issued by the authorization server
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-1.4 - Access Token
   */
  access_token: string;
  /** 
   * The type of the token issued - always "Bearer" for this implementation
   * @see https://datatracker.ietf.org/doc/html/rfc6750 - Bearer Token Usage
   */
  token_type: 'Bearer';
  /** 
   * The lifetime in seconds of the access token
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.1 - expires_in parameter
   */
  expires_in: number;
  /** 
   * The refresh token, which can be used to obtain new access tokens
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-1.5 - Refresh Token
   * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Refresh token rotation
   */
  refresh_token?: string;
  /** 
   * The scope of the access token
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.3 - Access Token Scope
   */
  scope: string;
}

/**
 * Error response format per RFC 6749
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.2 - Error Response
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2.1 - Authorization Error Response
 */
export interface ErrorResponse {
  /** 
   * A single ASCII error code
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.2 - Error codes
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2.1 - Authorization error codes
   */
  error: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client' | 'unsupported_grant_type' | 'invalid_scope' | 'server_error';
  /** 
   * Human-readable ASCII text providing additional information
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.2 - error_description
   */
  error_description?: string;
  /** 
   * A URI identifying a human-readable web page with information about the error
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.2 - error_uri
   */
  error_uri?: string;
}