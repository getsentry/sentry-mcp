/**
 * OAuth 2.0 Token Introspection Endpoint Handler
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7662 - OAuth 2.0 Token Introspection
 * @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.1 - Introspection Request
 * @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.2 - Introspection Response
 */

import type { Context } from 'hono';
import type { Storage, Client, TokenData, RefreshTokenData, OAuth21Config } from '../types';
import { verifyClientSecret } from '../lib/crypto';
import { hashToken } from '../lib/utils';

export class IntrospectHandler {
  constructor(
    private storage: Storage,
    private config: OAuth21Config
  ) {}

  /**
   * Handle POST /introspect - Introspect token status
   */
  async handle(c: Context) {
    try {
      const body = await c.req.parseBody();
      const token = body.token as string;
      const tokenTypeHint = body.token_type_hint as string;
      const clientId = body.client_id as string;
      const clientSecret = body.client_secret as string;

      // Token parameter is required
      if (!token) {
        return c.json({ 
          error: 'invalid_request',
          error_description: 'Token parameter is required'
        }, 400);
      }

      // Client authentication required
      if (!clientId) {
        return c.json({ 
          error: 'invalid_client',
          error_description: 'Client authentication required'
        }, 401);
      }

      const client = await this.getClient(clientId);
      if (!client) {
        return c.json({ error: 'invalid_client' }, 401);
      }

      // Verify client secret if confidential client
      if (client.secret) {
        const isValid = await verifyClientSecret(clientSecret || '', client.secret);
        if (!isValid) {
          return c.json({ error: 'invalid_client' }, 401);
        }
      }

      // Hash the token for lookup
      const tokenHash = await hashToken(token);
      
      // Try to find the token (check both access and refresh tokens)
      let tokenData: TokenData | RefreshTokenData | null = null;
      let tokenType = 'Bearer';
      
      // Check access token first (unless hint says otherwise)
      if (tokenTypeHint !== 'refresh_token') {
        tokenData = await this.storage.get<TokenData>(`token:${tokenHash}`, { type: 'json' });
      }
      
      // Check refresh token if not found or if hint suggests
      if (!tokenData) {
        const refreshData = await this.storage.get<RefreshTokenData>(`refresh:${tokenHash}`, { type: 'json' });
        if (refreshData) {
          tokenData = refreshData;
          tokenType = 'refresh_token';
        }
      }

      // If token not found or expired, return inactive
      if (!tokenData) {
        return c.json({ active: false });
      }

      // Check if token has expired
      const expiresAt = 'expiresAt' in tokenData ? tokenData.expiresAt : undefined;
      if (expiresAt && Date.now() > expiresAt) {
        return c.json({ active: false });
      }

      // Return active token information
      return c.json({
        active: true,
        scope: tokenData.scope,
        client_id: tokenData.clientId,
        token_type: tokenType,
        exp: expiresAt ? Math.floor(expiresAt / 1000) : undefined,
        iat: Math.floor(Date.now() / 1000),
        sub: tokenData.userId,
        iss: this.config.issuer,
      });
    } catch (error) {
      console.error('[OAuth] Introspection error:', error);
      return c.json({ active: false });
    }
  }

  private async getClient(clientId: string): Promise<Client | null> {
    return this.storage.get<Client>(`client:${clientId}`, { type: 'json' });
  }
}