/**
 * User Consent Management Handler
 * 
 * Note: Consent management endpoints are not standardized in OAuth 2.0/2.1 RFCs.
 * This is an implementation-specific extension common in OAuth providers.
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-10.2 - Client Impersonation concerns
 * @see https://openid.net/specs/openid-connect-core-1_0.html#Consent - OpenID Connect consent concepts
 */

import type { Context } from 'hono';
import type { Storage, OAuth21Config } from '../types';
import { ConsentManager } from '../core/consent';

export class ConsentsHandler {
  constructor(
    private storage: Storage,
    private config: OAuth21Config,
    private consentManager: ConsentManager
  ) {}

  /**
   * Handle GET /consents - List user's active consents
   */
  async list(c: Context) {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ 
        error: 'unauthorized', 
        error_description: 'Bearer token required' 
      }, 401);
    }

    const token = auth.substring(7);
    const tokenData = await this.storage.get<any>(
      `token:${token}`,
      { type: 'json' }
    );
    
    if (!tokenData || Date.now() > tokenData.expiresAt) {
      return c.json({ 
        error: 'invalid_token', 
        error_description: 'Token expired or invalid' 
      }, 401);
    }

    const userId = tokenData.userId;
    const consents = await this.consentManager.listUserConsents(userId);
    
    // Transform consents to include client names
    const enrichedConsents = await Promise.all(
      consents.map(async (consent) => {
        const client = await this.storage.get<any>(
          `client:${consent.clientId}`,
          { type: 'json' }
        );
        return {
          ...consent,
          clientName: client?.name || 'Unknown Application',
        };
      })
    );

    return c.json({
      consents: enrichedConsents,
      count: enrichedConsents.length,
    });
  }

  /**
   * Handle DELETE /consents/:clientId - Revoke consent for specific client
   */
  async revoke(c: Context) {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ 
        error: 'unauthorized', 
        error_description: 'Bearer token required' 
      }, 401);
    }

    const token = auth.substring(7);
    const tokenData = await this.storage.get<any>(
      `token:${token}`,
      { type: 'json' }
    );
    
    if (!tokenData || Date.now() > tokenData.expiresAt) {
      return c.json({ 
        error: 'invalid_token', 
        error_description: 'Token expired or invalid' 
      }, 401);
    }

    const userId = tokenData.userId;
    const clientId = c.req.param('clientId');
    
    if (!clientId) {
      return c.json({ 
        error: 'invalid_request', 
        error_description: 'Missing client_id' 
      }, 400);
    }

    await this.consentManager.revokeConsent(userId, clientId);
    
    return c.json({ 
      success: true,
      message: `Consent revoked for client ${clientId}`,
    });
  }

  /**
   * Handle DELETE /consents - Revoke all user consents
   */
  async revokeAll(c: Context) {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ 
        error: 'unauthorized', 
        error_description: 'Bearer token required' 
      }, 401);
    }

    const token = auth.substring(7);
    const tokenData = await this.storage.get<any>(
      `token:${token}`,
      { type: 'json' }
    );
    
    if (!tokenData || Date.now() > tokenData.expiresAt) {
      return c.json({ 
        error: 'invalid_token', 
        error_description: 'Token expired or invalid' 
      }, 401);
    }

    const userId = tokenData.userId;
    await this.consentManager.revokeAllUserConsents(userId);
    
    return c.json({ 
      success: true,
      message: 'All consents have been revoked',
    });
  }
}