/**
 * OAuth 2.0 Token Revocation Endpoint Handler
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7009 - OAuth 2.0 Token Revocation
 * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.1 - Revocation Request
 * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.2 - Revocation Response
 */

import type { Context } from 'hono';
import type { Storage, Client, TokenData, RefreshTokenData, OAuth21Config } from '../types';
import { verifyClientSecret } from '../lib/crypto';
import { hashToken } from '../lib/utils';

export class RevokeHandler {
  constructor(
    private storage: Storage,
    private config: OAuth21Config
  ) {}

  /**
   * Handle POST /revoke - Revoke access or refresh token
   */
  async handle(c: Context) {
    try {
      const body = await c.req.parseBody();
      const token = body.token as string;
      const tokenTypeHint = body.token_type_hint as string;
      const clientId = body.client_id as string;
      const clientSecret = body.client_secret as string;
      
      // RFC 7009: Invalid tokens do not cause an error
      if (!token) {
        return c.json({ success: true });
      }
      
      // Client authentication required for confidential clients
      if (clientId) {
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
        
        // Try to revoke the token
        await this.revokeToken(token, tokenTypeHint, client);
      }
      
      // RFC 7009: Always return 200 OK regardless of token validity
      return c.json({ success: true });
    } catch (error) {
      console.error('[OAuth] Revocation error:', error);
      // Still return success per RFC 7009
      return c.json({ success: true });
    }
  }

  private async revokeToken(token: string, hint: string | undefined, client: Client) {
    // Hash the token for lookup
    const tokenHash = await hashToken(token);
    
    // Try access token first (unless hint says otherwise)
    if (hint !== 'refresh_token') {
      const tokenData = await this.storage.get<TokenData>(`token:${tokenHash}`, { type: 'json' });
      if (tokenData && tokenData.clientId === client.id) {
        await this.storage.delete(`token:${tokenHash}`);
        console.log('[OAuth] Access token revoked:', {
          clientId: client.id,
          userId: tokenData.userId,
          timestamp: new Date().toISOString()
        });
        return;
      }
    }
    
    // Try refresh token
    const refreshData = await this.storage.get<RefreshTokenData>(`refresh:${tokenHash}`, { type: 'json' });
    if (refreshData && refreshData.clientId === client.id) {
      await this.storage.delete(`refresh:${tokenHash}`);
      
      // Also revoke associated access tokens if we track them
      if (refreshData.grantId) {
        const tokenMapping = await this.storage.get<any>(
          `grant-tokens:${refreshData.grantId}`,
          { type: 'json' }
        );
        
        if (tokenMapping) {
          await this.storage.delete(`token:${tokenMapping.accessToken}`);
          await this.storage.delete(`grant-tokens:${refreshData.grantId}`);
        }
      }
      
      console.log('[OAuth] Refresh token revoked:', {
        clientId: client.id,
        userId: refreshData.userId,
        timestamp: new Date().toISOString()
      });
    }
  }

  private async getClient(clientId: string): Promise<Client | null> {
    return this.storage.get<Client>(`client:${clientId}`, { type: 'json' });
  }
}