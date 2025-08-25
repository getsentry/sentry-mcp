/**
 * OAuth 2.1 Token Endpoint Handler
 * 
 * Handles token issuance, refresh, and validation.
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.2 - Token Endpoint
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-4.1.3 - Access Token Request
 * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.5 - PKCE Verification
 */

import type { Context } from 'hono';
import { z } from 'zod';
import type { Storage, Client, Grant, RefreshTokenData, OAuth21Config } from '../types';
import { generateSecureToken, generateStructuredToken, hashToken, verifyCSRFToken } from '../lib/utils';
import { verifyClientSecret } from '../lib/crypto';
import { decryptContextFromStorage, encryptContextForStorage } from '../lib/crypto-context';

// Constants
const ACCESS_TOKEN_EXPIRY_MS = 3600000; // 1 hour
const REFRESH_TOKEN_EXPIRY_MS = 7776000000; // 90 days
const MAX_AUTHORIZATION_LIFETIME_MS = 31536000000; // 1 year
const ACCESS_TOKEN_EXPIRY_SECONDS = 3600;
const REFRESH_TOKEN_EXPIRY_SECONDS = 7776000;

// Request schema
const TokenRequestSchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  code: z.string().optional(),
  redirect_uri: z.string().url().optional(),
  client_id: z.string(),
  client_secret: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

export class TokenHandler {
  constructor(
    private storage: Storage,
    private config: OAuth21Config
  ) {}

  /**
   * Handle POST /token - Exchange authorization code or refresh token
   * 
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.2 - Token Endpoint
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3 - Access Token Request
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-6 - Refreshing an Access Token
   */
  async handle(c: Context) {
    try {
      const body = await c.req.parseBody();
      const params = TokenRequestSchema.parse(body);

      // Get client
      const client = await this.getClient(params.client_id);
      if (!client) {
        return c.json({ error: 'invalid_client' }, 401);
      }

      // Verify client secret for confidential clients
      // @see https://datatracker.ietf.org/doc/html/rfc6749#section-2.3.1 - Client Authentication
      if (client.secret) {
        const providedSecret = params.client_secret || '';
        const isValid = await verifyClientSecret(providedSecret, client.secret);
        if (!isValid) {
          console.warn('[OAuth] Failed client authentication:', {
            clientId: params.client_id,
            grantType: params.grant_type,
            timestamp: new Date().toISOString()
          });
          // @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.2 - invalid_client error
          return c.json({ error: 'invalid_client' }, 401);
        }
      }

      if (params.grant_type === 'authorization_code') {
        return this.handleAuthorizationCodeGrant(c, params, client);
      } else {
        return this.handleRefreshTokenGrant(c, params, client);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ 
          error: 'invalid_request',
          error_description: error.errors[0].message 
        }, 400);
      }
      throw error;
    }
  }

  /**
   * Process authorization code grant type
   * 
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3 - Access Token Request
   * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.5 - PKCE Verification
   * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Authorization Code Reuse
   */
  private async handleAuthorizationCodeGrant(
    c: Context,
    params: z.infer<typeof TokenRequestSchema>,
    client: Client
  ) {
    if (!params.code) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    // Get and immediately delete grant to prevent race conditions
    // This ensures single-use of authorization codes as required by OAuth 2.1
    // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Authorization code single use
    const grantData = await this.storage.get<Grant>(`grant:${params.code}`, { type: 'json' });
    
    if (!grantData) {
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Authorization code not found or expired'
      }, 400);
    }

    // Immediately delete the code to prevent reuse (atomic operation)
    // This prevents race conditions where two requests could both read the code
    await this.storage.delete(`grant:${params.code}`);

    // Verify grant hasn't expired
    // @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2 - Authorization codes MUST expire
    if (Date.now() > grantData.expiresAt) {
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Authorization code has expired'
      }, 400);
    }

    // Verify client matches
    if (grantData.clientId !== params.client_id) {
      // Delete code on client mismatch (potential attack)
      console.warn('[OAuth] Client mismatch for authorization code:', {
        expected: grantData.clientId,
        received: params.client_id
      });
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Authorization code was issued to a different client'
      }, 400);
    }

    // Check for code reuse (OAuth 2.1 requirement)
    // Since we delete immediately, this should never happen unless there's an attack
    // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Authorization code reuse
    // @see https://datatracker.ietf.org/doc/html/rfc6749#section-10.5 - Authorization Code Reuse Attack
    if (grantData.exchanged) {
      console.error('[OAuth] Authorization code reuse detected for grant:', grantData.id);
      await this.invalidateGrantFamily(grantData.id);
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Authorization code has already been used'
      }, 400);
    }

    // Validate redirect_uri if present
    // @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3 - redirect_uri MUST match
    if (grantData.redirectUri) {
      if (!params.redirect_uri) {
        return c.json({ 
          error: 'invalid_request',
          error_description: 'redirect_uri is required (was included in authorization request)'
        }, 400);
      }
      if (params.redirect_uri !== grantData.redirectUri) {
        return c.json({ 
          error: 'invalid_grant',
          error_description: 'redirect_uri does not match'
        }, 400);
      }
    }

    // Verify PKCE if used
    // @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.5 - PKCE Verification
    // @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.6 - Server Verifies code_verifier
    if (grantData.codeChallenge) {
      if (!params.code_verifier) {
        return c.json({ 
          error: 'invalid_grant',
          error_description: 'code_verifier required for PKCE'
        }, 400);
      }

      const valid = await this.verifyPKCE(
        params.code_verifier,
        grantData.codeChallenge,
        grantData.codeChallengeMethod || 'S256'
      );

      if (!valid) {
        return c.json({ error: 'invalid_grant' }, 400);
      }
    } else if (params.code_verifier) {
      // Reject unexpected verifier (security best practice)
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'code_verifier provided but no PKCE challenge was used'
      }, 400);
    }

    // Check maximum authorization lifetime
    const maxLifetime = this.config.maxAuthorizationLifetime ?? MAX_AUTHORIZATION_LIFETIME_MS;
    const grantAge = Date.now() - grantData.createdAt;
    
    if (grantAge > maxLifetime) {
      console.warn('[OAuth] Authorization lifetime exceeded:', {
        clientId: grantData.clientId,
        userId: grantData.userId,
        grantAge: Math.floor(grantAge / 1000 / 60 / 60 / 24), // days
        maxLifetime: Math.floor(maxLifetime / 1000 / 60 / 60 / 24), // days
      });
      
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Authorization has exceeded maximum lifetime'
      }, 400);
    }

    // Decrypt context if it exists (OAuth proxy functionality)
    let context = null;
    if (grantData.encryptedContext && grantData.authCodeWrappedKey && grantData.iv) {
      try {
        context = await decryptContextFromStorage(
          grantData.encryptedContext,
          grantData.authCodeWrappedKey,
          grantData.iv,
          params.code // Use the authorization code to unwrap
        );
      } catch (error) {
        console.error('[OAuth] Failed to decrypt context during code exchange:', error);
      }
    }

    // Call token exchange callback if configured (OAuth proxy functionality)
    let accessTokenTTL = ACCESS_TOKEN_EXPIRY_SECONDS;
    if (this.config.tokenExchangeCallback && context) {
      try {
        const result = await this.config.tokenExchangeCallback({
          grantType: 'authorization_code',
          clientId: grantData.clientId,
          userId: grantData.userId,
          scope: grantData.scope.split(' '),
          context: context || {},
        });
        
        if (result) {
          if (result.newContext) {
            context = result.newContext;
          }
          if (result.accessTokenTTL) {
            accessTokenTTL = result.accessTokenTTL;
          }
        }
      } catch (error) {
        console.error('[OAuth] Token exchange callback error:', error);
      }
    }

    // Generate structured tokens
    const accessToken = generateStructuredToken(grantData.userId, grantData.id);
    const refreshToken = generateStructuredToken(grantData.userId, grantData.id);
    
    // Hash tokens for storage
    const accessTokenHash = await hashToken(accessToken);
    const refreshTokenHash = await hashToken(refreshToken);
    
    // Log successful token issuance
    console.log('[OAuth] Token issued:', {
      clientId: grantData.clientId,
      userId: grantData.userId,
      scope: grantData.scope,
      grantType: 'authorization_code',
      timestamp: new Date().toISOString()
    });

    // Prepare token data - store everything together
    const tokenData: any = {
      userId: grantData.userId,
      clientId: grantData.clientId,
      scope: grantData.scope,
      grantId: grantData.id,
      expiresAt: Date.now() + (accessTokenTTL * 1000),
    };
    
    const refreshData: any = {
      userId: grantData.userId,
      clientId: grantData.clientId,
      scope: grantData.scope,
      grantId: grantData.id,
      expiresAt: Date.now() + REFRESH_TOKEN_EXPIRY_MS,
      createdAt: grantData.createdAt,
    };

    // Encrypt context if it exists (OAuth proxy functionality)
    if (context) {
      // Encrypt context with access token
      const accessEncrypted = await encryptContextForStorage(context, accessToken);
      tokenData.encryptedContext = accessEncrypted.encryptedContext;
      tokenData.wrappedKey = accessEncrypted.wrappedKey;
      tokenData.iv = accessEncrypted.iv;
      
      // Encrypt context with refresh token
      const refreshEncrypted = await encryptContextForStorage(context, refreshToken);
      refreshData.encryptedContext = refreshEncrypted.encryptedContext;
      refreshData.wrappedKey = refreshEncrypted.wrappedKey;
      refreshData.iv = refreshEncrypted.iv;
    }

    // Store tokens with hashed keys
    await this.storage.put(
      `token:${accessTokenHash}`,
      JSON.stringify(tokenData),
      { expirationTtl: accessTokenTTL }
    );

    await this.storage.put(
      `refresh:${refreshTokenHash}`,
      JSON.stringify(refreshData),
      { expirationTtl: REFRESH_TOKEN_EXPIRY_SECONDS }
    );
    
    // Track tokens for grant family
    await this.storage.put(
      `grant-tokens:${grantData.id}`,
      JSON.stringify({
        accessToken,
        refreshToken,
        createdAt: Date.now(),
      }),
      { expirationTtl: 86400 }
    );

    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
      refresh_token: refreshToken,
      scope: grantData.scope,
    });
  }

  /**
   * Process refresh token grant type
   * 
   * @see https://datatracker.ietf.org/doc/html/rfc6749#section-6 - Refreshing an Access Token
   * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Refresh Token Rotation
   */
  private async handleRefreshTokenGrant(
    c: Context,
    params: z.infer<typeof TokenRequestSchema>,
    client: Client
  ) {
    if (!params.refresh_token) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    // Hash the refresh token for lookup
    const refreshTokenHash = await hashToken(params.refresh_token);
    
    let refreshData = await this.storage.get<RefreshTokenData>(
      `refresh:${refreshTokenHash}`,
      { type: 'json' }
    );

    // Check if this is a previous token being used during grace period
    // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-4.13.2 - Grace Period
    let isPreviousToken = false;
    if (!refreshData && this.config.strictMode) {
      // Look for any refresh token that has this as its previous token
      const { keys } = await this.storage.list({ prefix: 'refresh:' });
      for (const { name } of keys) {
        const data = await this.storage.get<RefreshTokenData>(name, { type: 'json' });
        if (data?.previousTokenHash === refreshTokenHash && !data.isRotated) {
          // Found a newer token that replaced this one, but new token hasn't been used yet
          refreshData = data;
          isPreviousToken = true;
          break;
        }
      }
    }
    
    if (!refreshData) {
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Refresh token not found or expired'
      }, 400);
    }

    // Verify client owns the refresh token
    // @see https://datatracker.ietf.org/doc/html/rfc6749#section-10.4 - Refresh Token Leak Protection
    if (refreshData.clientId !== client.id) {
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Refresh token was issued to a different client'
      }, 400);
    }

    // Check if refresh token has expired
    if (refreshData.expiresAt && Date.now() > refreshData.expiresAt) {
      await this.storage.delete(`refresh:${refreshTokenHash}`);
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Refresh token has expired'
      }, 400);
    }

    // If using previous token during grace period, invalidate it now
    if (isPreviousToken && refreshData.previousTokenHash) {
      await this.storage.delete(`refresh:${refreshData.previousTokenHash}`);
      // Mark the current token as rotated since it's being used
      refreshData.isRotated = true;
      await this.storage.put(
        `refresh:${refreshTokenHash}`,
        JSON.stringify(refreshData),
        { expirationTtl: REFRESH_TOKEN_EXPIRY_SECONDS }
      );
    }

    // Delete old refresh token (rotation for security)
    if (this.config.strictMode && !isPreviousToken) {
      // Don't delete immediately - keep as previous token for grace period
      // await this.storage.delete(`refresh:${refreshTokenHash}`);
    }

    // Decrypt context if it exists (OAuth proxy functionality)
    let context = null;
    if (refreshData.encryptedContext && refreshData.wrappedKey && refreshData.iv) {
      try {
        context = await decryptContextFromStorage(
          refreshData.encryptedContext,
          refreshData.wrappedKey,
          refreshData.iv,
          params.refresh_token // Use the refresh token to unwrap
        );
      } catch (error) {
        console.error('[OAuth] Failed to decrypt context during refresh:', error);
      }
    }

    // Call token exchange callback if configured (OAuth proxy functionality)
    let accessTokenTTL = ACCESS_TOKEN_EXPIRY_SECONDS;
    if (this.config.tokenExchangeCallback && context) {
      try {
        const result = await this.config.tokenExchangeCallback({
          grantType: 'refresh_token',
          clientId: refreshData.clientId,
          userId: refreshData.userId,
          scope: refreshData.scope.split(' '),
          context: context || {},
        });
        
        if (result) {
          if (result.newContext) {
            context = result.newContext;
          }
          if (result.accessTokenTTL) {
            accessTokenTTL = result.accessTokenTTL;
          }
        }
      } catch (error) {
        console.error('[OAuth] Token exchange callback error during refresh:', error);
      }
    }

    // Generate new structured tokens
    const accessToken = generateStructuredToken(refreshData.userId, refreshData.grantId || generateSecureToken());
    const newRefreshToken = this.config.strictMode ? 
      generateStructuredToken(refreshData.userId, refreshData.grantId || generateSecureToken()) : 
      params.refresh_token;

    // Check maximum authorization lifetime
    const maxLifetime = this.config.maxAuthorizationLifetime ?? MAX_AUTHORIZATION_LIFETIME_MS;
    const grantCreatedAt = refreshData.createdAt;
    const grantAge = Date.now() - grantCreatedAt;
    
    if (grantAge > maxLifetime) {
      console.warn('[OAuth] Refresh token lifetime exceeded:', {
        clientId: refreshData.clientId,
        userId: refreshData.userId,
        grantAge: Math.floor(grantAge / 1000 / 60 / 60 / 24), // days
      });
      
      await this.storage.delete(`refresh:${refreshTokenHash}`);
      
      return c.json({ 
        error: 'invalid_grant',
        error_description: 'Authorization has exceeded maximum lifetime'
      }, 400);
    }

    // Hash new tokens for storage
    const accessTokenHash = await hashToken(accessToken);
    const newRefreshTokenHash = this.config.strictMode ? 
      await hashToken(newRefreshToken) : 
      refreshTokenHash;

    // Prepare token data with optional encrypted context
    const tokenData: any = {
      userId: refreshData.userId,
      clientId: refreshData.clientId,
      scope: refreshData.scope,
      grantId: refreshData.grantId,
      expiresAt: Date.now() + (accessTokenTTL * 1000),
    };
    
    const newRefreshData: any = {
      ...refreshData,
      expiresAt: Date.now() + REFRESH_TOKEN_EXPIRY_MS,
      createdAt: grantCreatedAt,
      previousTokenHash: isPreviousToken ? undefined : refreshTokenHash,
      isRotated: false,
    };

    // Encrypt context if it exists (OAuth proxy functionality)
    if (context) {
      // Encrypt context with access token
      const accessEncrypted = await encryptContextForStorage(context, accessToken);
      tokenData.encryptedContext = accessEncrypted.encryptedContext;
      tokenData.wrappedKey = accessEncrypted.wrappedKey;
      tokenData.iv = accessEncrypted.iv;
      
      // Encrypt context with new refresh token if rotating
      if (this.config.strictMode) {
        const refreshEncrypted = await encryptContextForStorage(context, newRefreshToken);
        newRefreshData.encryptedContext = refreshEncrypted.encryptedContext;
        newRefreshData.wrappedKey = refreshEncrypted.wrappedKey;
        newRefreshData.iv = refreshEncrypted.iv;
      }
    }

    // Store new tokens with hashed keys
    await this.storage.put(
      `token:${accessTokenHash}`,
      JSON.stringify(tokenData),
      { expirationTtl: accessTokenTTL }
    );

    if (this.config.strictMode) {
      // Store new refresh token with reference to previous token for grace period
      await this.storage.put(
        `refresh:${newRefreshTokenHash}`,
        JSON.stringify(newRefreshData),
        { expirationTtl: REFRESH_TOKEN_EXPIRY_SECONDS }
      );
      
      // Mark old token as rotated but keep it for grace period
      if (!isPreviousToken) {
        await this.storage.put(
          `refresh:${refreshTokenHash}`,
          JSON.stringify({
            ...refreshData,
            isRotated: true, // Mark as rotated but still valid during grace period
          }),
          { expirationTtl: 86400 } // Keep for 24 hours grace period
        );
      }
    }

    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
      refresh_token: newRefreshToken,
      scope: refreshData.scope,
    });
  }

  private async verifyPKCE(verifier: string, challenge: string, method: 'S256' | 'plain'): Promise<boolean> {
    if (method === 'plain') {
      return verifier === challenge;
    }
    
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    
    let binary = '';
    for (const byte of hashArray) {
      binary += String.fromCharCode(byte);
    }
    
    const computed = btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    return computed === challenge;
  }

  private async invalidateGrantFamily(grantId: string) {
    console.log('[OAuth] Invalidating grant family:', grantId);
    
    try {
      const tokenMapping = await this.storage.get<any>(
        `grant-tokens:${grantId}`,
        { type: 'json' }
      );
      
      if (tokenMapping) {
        await this.storage.delete(`token:${tokenMapping.accessToken}`);
        await this.storage.delete(`refresh:${tokenMapping.refreshToken}`);
        await this.storage.delete(`grant-tokens:${grantId}`);
      }
      
      const grantKeys = await this.storage.list({ prefix: 'grant:' });
      for (const { name } of grantKeys.keys) {
        const grant = await this.storage.get<Grant>(name, { type: 'json' });
        if (grant && grant.id === grantId) {
          await this.storage.delete(name);
        }
      }
    } catch (error) {
      console.error('[OAuth] Error invalidating grant family:', error);
    }
  }

  private async getClient(clientId: string): Promise<Client | null> {
    return this.storage.get<Client>(`client:${clientId}`, { type: 'json' });
  }
}