/**
 * OAuth Service Interface
 * 
 * Defines the contract for OAuth operations, allowing different implementations
 * for production (Cloudflare KV) and testing (in-memory).
 */

import type { ClientInfo } from "@sentry/hono-oauth-provider";
import type { WorkerProps } from "../types";

export interface Grant {
  id: string;
  userId: string;
  clientId: string;
  scope: string;
  code: string;
  createdAt: number;
  expiresAt: number;
}

export interface Token {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

export interface OAuthService {
  /**
   * Validates an access token and returns the associated user properties
   */
  validateToken(token: string): Promise<WorkerProps | null>;
  
  /**
   * Gets client information by ID
   */
  getClient(clientId: string): Promise<ClientInfo | null>;
  
  /**
   * Creates a new grant for user authorization
   */
  createGrant(userId: string, clientId: string, scope: string): Promise<Grant>;
  
  /**
   * Exchanges an authorization code for an access token
   */
  exchangeCode(code: string, clientId: string): Promise<Token | null>;
  
  /**
   * Revokes a grant and all associated tokens
   */
  revokeGrant(grantId: string, userId: string): Promise<void>;
  
  /**
   * Registers a new OAuth client
   */
  registerClient(client: ClientInfo): Promise<void>;
  
  /**
   * Parse auth request (for OAuth provider compatibility)
   */
  parseAuthRequest?(request: Request): Promise<any>;
  
  /**
   * Complete authorization (for OAuth provider compatibility)
   */
  completeAuthorization?(options: any): Promise<{ redirectTo: string }>;
  
  /**
   * Lookup client (for OAuth provider compatibility)
   */
  lookupClient?(clientId: string): Promise<ClientInfo | null>;
}