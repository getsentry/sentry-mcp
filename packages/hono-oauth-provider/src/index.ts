/**
 * Hono OAuth 2.1 Provider
 * 
 * A modular OAuth 2.1 authorization server implementation for Hono.
 * Implements the latest OAuth 2.1 draft specification with focus on security and simplicity.
 * 
 * @packageDocumentation
 */

// Export the OAuth provider and helpers
export { 
  OAuthProvider,
  requireOAuthScope 
} from './oauth-provider';

// Export types
export type {
  OAuth21Config,
  Storage,
  Client,
  Grant,
  TokenData,
  RefreshTokenData,
  TokenResponse,
  ErrorResponse
} from './types';

// Export consent manager for advanced usage
export { ConsentManager } from './core/consent';
export type { UserConsent, ConsentOptions } from './core/consent';

// Export crypto utilities for client implementations
export { 
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret 
} from './lib/crypto';

// Export validation utilities
export {
  ClientRegistrationSchema,
  sanitizeClientMetadata,
  validateRedirectUri
} from './lib/validation';

// Export general utilities
export {
  generateSecureToken,
  generateCSRFToken,
  verifyCSRFToken,
  escapeHtml
} from './lib/utils';

