/**
 * OAuth 2.1 Error Handling
 * 
 * Comprehensive error responses with descriptive messages per RFC 6749.
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.2 - Error Response
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2.1 - Authorization Error Response
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.2.2.1 - Access Token Error Response
 */

import type { Context } from 'hono';

/**
 * OAuth error codes per RFC 6749
 */
export enum OAuthErrorCode {
  // Request errors
  INVALID_REQUEST = 'invalid_request',
  UNAUTHORIZED_CLIENT = 'unauthorized_client',
  ACCESS_DENIED = 'access_denied',
  UNSUPPORTED_RESPONSE_TYPE = 'unsupported_response_type',
  INVALID_SCOPE = 'invalid_scope',
  SERVER_ERROR = 'server_error',
  TEMPORARILY_UNAVAILABLE = 'temporarily_unavailable',
  
  // Token errors
  INVALID_CLIENT = 'invalid_client',
  INVALID_GRANT = 'invalid_grant',
  UNSUPPORTED_GRANT_TYPE = 'unsupported_grant_type',
  
  // Additional errors
  INVALID_TOKEN = 'invalid_token',
  INSUFFICIENT_SCOPE = 'insufficient_scope',
  INVALID_CLIENT_METADATA = 'invalid_client_metadata',
  INVALID_REDIRECT_URI = 'invalid_redirect_uri',
}

/**
 * Detailed error descriptions for better debugging
 */
const ERROR_DESCRIPTIONS: Record<string, string> = {
  // Authorization errors
  'pkce_required': 'PKCE (Proof Key for Code Exchange) is required for public clients per OAuth 2.1',
  'redirect_uri_mismatch': 'The redirect_uri parameter does not match any pre-registered URIs for this client',
  'redirect_uri_invalid': 'The redirect_uri contains invalid characters or uses an insecure protocol',
  'client_not_found': 'The specified client_id does not exist or has been revoked',
  'scope_not_granted': 'The requested scope exceeds the scope granted by the resource owner',
  'consent_required': 'User consent is required before authorization can be granted',
  
  // Token errors
  'code_expired': 'The authorization code has expired. Codes are valid for 10 minutes',
  'code_already_used': 'The authorization code has already been exchanged for tokens',
  'code_invalid': 'The authorization code is invalid or was issued to another client',
  'verifier_required': 'A code_verifier is required when PKCE was used during authorization',
  'verifier_invalid': 'The code_verifier does not match the code_challenge used during authorization',
  'verifier_unexpected': 'A code_verifier was provided but PKCE was not used during authorization',
  'refresh_token_expired': 'The refresh token has expired and a new authorization is required',
  'refresh_token_invalid': 'The refresh token is invalid or was issued to another client',
  'refresh_token_revoked': 'The refresh token has been revoked',
  'lifetime_exceeded': 'The authorization has exceeded its maximum lifetime. Please re-authenticate',
  
  // Client authentication errors
  'client_authentication_failed': 'Client authentication failed due to invalid credentials',
  'client_secret_required': 'Client authentication is required for this request',
  'client_secret_invalid': 'The provided client_secret is incorrect',
  
  // Registration errors
  'client_name_required': 'A client_name is required for registration',
  'redirect_uris_required': 'At least one redirect_uri is required for registration',
  'redirect_uri_localhost': 'Localhost URIs are only allowed in development mode',
  'redirect_uri_http': 'HTTP URIs are not allowed for production clients (use HTTPS)',
  'too_many_redirect_uris': 'Maximum of 10 redirect URIs allowed per client',
  
  // Server errors
  'storage_error': 'A storage error occurred while processing your request',
  'crypto_error': 'A cryptographic error occurred while processing your request',
  'internal_error': 'An unexpected error occurred. Please try again later',
  
  // CSRF errors
  'csrf_token_missing': 'CSRF token is required for this request',
  'csrf_token_invalid': 'The CSRF token is invalid or has expired',
  'csrf_token_mismatch': 'The CSRF token does not match the expected value',
};

/**
 * OAuth error response class
 */
export class OAuthError extends Error {
  constructor(
    public code: OAuthErrorCode | string,
    public description?: string,
    public statusCode: number = 400,
    public uri?: string
  ) {
    super(description || code);
    this.name = 'OAuthError';
  }

  /**
   * Convert to JSON response format
   */
  toJSON() {
    const response: any = { error: this.code };
    if (this.description) response.error_description = this.description;
    if (this.uri) response.error_uri = this.uri;
    return response;
  }

  /**
   * Send error response
   */
  respond(c: Context) {
    // Cast to satisfy Hono's type requirements for status codes
    return c.json(this.toJSON(), this.statusCode as Parameters<typeof c.json>[1]);
  }
}

/**
 * Create an OAuth error with a predefined description
 */
export function createError(
  code: OAuthErrorCode,
  key?: keyof typeof ERROR_DESCRIPTIONS,
  customMessage?: string
): OAuthError {
  const description = customMessage || (key ? ERROR_DESCRIPTIONS[key] : undefined);
  
  // Determine appropriate status code
  let statusCode = 400;
  if (code === OAuthErrorCode.INVALID_CLIENT || code === OAuthErrorCode.INVALID_TOKEN) {
    statusCode = 401;
  } else if (code === OAuthErrorCode.INSUFFICIENT_SCOPE) {
    statusCode = 403;
  } else if (code === OAuthErrorCode.SERVER_ERROR) {
    statusCode = 500;
  } else if (code === OAuthErrorCode.TEMPORARILY_UNAVAILABLE) {
    statusCode = 503;
  }
  
  return new OAuthError(code, description, statusCode);
}

/**
 * Authorization error helpers
 */
export const AuthorizationErrors = {
  pkceRequired: () => createError(OAuthErrorCode.INVALID_REQUEST, 'pkce_required'),
  redirectUriMismatch: () => createError(OAuthErrorCode.INVALID_REQUEST, 'redirect_uri_mismatch'),
  redirectUriInvalid: () => createError(OAuthErrorCode.INVALID_REQUEST, 'redirect_uri_invalid'),
  clientNotFound: () => createError(OAuthErrorCode.INVALID_CLIENT, 'client_not_found'),
  scopeNotGranted: () => createError(OAuthErrorCode.INVALID_SCOPE, 'scope_not_granted'),
  consentRequired: () => createError(OAuthErrorCode.ACCESS_DENIED, 'consent_required'),
  csrfTokenMissing: () => createError(OAuthErrorCode.INVALID_REQUEST, 'csrf_token_missing'),
  csrfTokenInvalid: () => createError(OAuthErrorCode.INVALID_REQUEST, 'csrf_token_invalid'),
};

/**
 * Token error helpers
 */
export const TokenErrors = {
  codeExpired: () => createError(OAuthErrorCode.INVALID_GRANT, 'code_expired'),
  codeAlreadyUsed: () => createError(OAuthErrorCode.INVALID_GRANT, 'code_already_used'),
  codeInvalid: () => createError(OAuthErrorCode.INVALID_GRANT, 'code_invalid'),
  verifierRequired: () => createError(OAuthErrorCode.INVALID_GRANT, 'verifier_required'),
  verifierInvalid: () => createError(OAuthErrorCode.INVALID_GRANT, 'verifier_invalid'),
  verifierUnexpected: () => createError(OAuthErrorCode.INVALID_GRANT, 'verifier_unexpected'),
  refreshTokenExpired: () => createError(OAuthErrorCode.INVALID_GRANT, 'refresh_token_expired'),
  refreshTokenInvalid: () => createError(OAuthErrorCode.INVALID_GRANT, 'refresh_token_invalid'),
  refreshTokenRevoked: () => createError(OAuthErrorCode.INVALID_GRANT, 'refresh_token_revoked'),
  lifetimeExceeded: () => createError(OAuthErrorCode.INVALID_GRANT, 'lifetime_exceeded'),
  clientAuthenticationFailed: () => createError(OAuthErrorCode.INVALID_CLIENT, 'client_authentication_failed'),
  clientSecretRequired: () => createError(OAuthErrorCode.INVALID_CLIENT, 'client_secret_required'),
  clientSecretInvalid: () => createError(OAuthErrorCode.INVALID_CLIENT, 'client_secret_invalid'),
};

/**
 * Registration error helpers
 */
export const RegistrationErrors = {
  clientNameRequired: () => createError(OAuthErrorCode.INVALID_CLIENT_METADATA, 'client_name_required'),
  redirectUrisRequired: () => createError(OAuthErrorCode.INVALID_CLIENT_METADATA, 'redirect_uris_required'),
  redirectUriLocalhost: () => createError(OAuthErrorCode.INVALID_REDIRECT_URI, 'redirect_uri_localhost'),
  redirectUriHttp: () => createError(OAuthErrorCode.INVALID_REDIRECT_URI, 'redirect_uri_http'),
  tooManyRedirectUris: () => createError(OAuthErrorCode.INVALID_CLIENT_METADATA, 'too_many_redirect_uris'),
};

/**
 * Server error helpers
 */
export const ServerErrors = {
  storageError: (details?: string) => 
    createError(OAuthErrorCode.SERVER_ERROR, 'storage_error', details),
  cryptoError: (details?: string) => 
    createError(OAuthErrorCode.SERVER_ERROR, 'crypto_error', details),
  internalError: (details?: string) => 
    createError(OAuthErrorCode.SERVER_ERROR, 'internal_error', details),
  temporarilyUnavailable: (retryAfter?: number) => {
    const error = createError(OAuthErrorCode.TEMPORARILY_UNAVAILABLE);
    if (retryAfter) {
      error.description = `Service temporarily unavailable. Please retry after ${retryAfter} seconds`;
    }
    return error;
  },
};

/**
 * Error response handler with logging
 */
export function handleOAuthError(c: Context, error: unknown): Response {
  if (error instanceof OAuthError) {
    // Log OAuth errors at appropriate level
    if (error.statusCode >= 500) {
      console.error('[OAuth] Server error:', error.code, error.description);
    } else if (error.statusCode === 401) {
      console.warn('[OAuth] Authentication error:', error.code, error.description);
    } else {
      console.log('[OAuth] Client error:', error.code, error.description);
    }
    
    return error.respond(c);
  }
  
  // Log unexpected errors
  console.error('[OAuth] Unexpected error:', error);
  
  // Return generic error for security
  const genericError = ServerErrors.internalError();
  return genericError.respond(c);
}