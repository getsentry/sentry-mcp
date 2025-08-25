/**
 * Token Endpoint Tests
 * Tests for OAuth 2.1 token issuance and refresh
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3 - Access Token Request
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-4.1.3 - OAuth 2.1 Token Request
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-6 - Refreshing an Access Token
 * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.5 - PKCE Verification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { OAuthProvider as OAuthProviderFunc } from '../../index';
import { OAuthProviderTestWrapper as OAuthProvider } from '../test-helpers';
import { hashClientSecret } from '../../lib/crypto';
import { hashToken } from '../../lib/utils';

class MemoryStorage {
  private store = new Map<string, any>();
  
  async get(key: string): Promise<string | null>;
  async get<T>(key: string, options: { type: 'json' }): Promise<T | null>;
  async get(key: string, options?: { type?: string }): Promise<any> {
    const val = this.store.get(key);
    if (!val) return null;
    return options?.type === 'json' && typeof val === 'string' 
      ? JSON.parse(val) 
      : val;
  }
  
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  
  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const keys = Array.from(this.store.keys())
      .filter(k => !options?.prefix || k.startsWith(options.prefix))
      .map(name => ({ name }));
    return { keys };
  }
}

describe('Token Endpoint', () => {
  let storage: MemoryStorage;
  let provider: OAuthProvider;
  let app: Hono;

  beforeEach(async () => {
    storage = new MemoryStorage();
    provider = new OAuthProvider({
      storage,
      issuer: 'http://localhost:8787',
      scopesSupported: ['read', 'write'],
      strictMode: true, // Enable OAuth 2.1 strict mode for refresh token rotation
    });
    app = provider.getApp();

    // Pre-register a test client with hashed secret
    const hashedSecret = await hashClientSecret('test-secret');
    await storage.put('client:test-client', JSON.stringify({
      id: 'test-client',
      secret: hashedSecret,
      name: 'Test Client',
      redirectUris: ['http://localhost:3000/callback'],
    }));
  });

  describe('Authorization Code Grant', () => {
    it('should exchange valid code for tokens', async () => {
      // Create a valid grant
      const code = 'test-code-123';
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-123',
        clientId: 'test-client',
        userId: 'user-1',
        scope: 'read',
        code,
        redirectUri: 'http://localhost:3000/callback',
        expiresAt: Date.now() + 600000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-secret',
          redirect_uri: 'http://localhost:3000/callback',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const tokens = await response.json() as any;
      
      expect(tokens).toHaveProperty('access_token');
      expect(tokens).toHaveProperty('refresh_token');
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.expires_in).toBe(3600);
    });

    it('should reject invalid client secret', async () => {
      const code = 'test-code-456';
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-456',
        clientId: 'test-client',
        userId: 'user-1',
        scope: 'read',
        code,
        expiresAt: Date.now() + 600000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'wrong-secret',
        }).toString(),
      });

      expect(response.status).toBe(401);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_client');
    });

    it('should reject expired authorization code per RFC 6749 Section 4.1.2', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2 - Authorization codes MUST expire
      const code = 'expired-code';
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-expired',
        clientId: 'test-client',
        userId: 'user-1',
        scope: 'read',
        code,
        expiresAt: Date.now() - 1000, // Already expired
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_grant');
    });

    it('should prevent authorization code reuse per OAuth 2.1 Section 6.1', async () => {
      // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Authorization code reuse prevention
      const code = 'reuse-code';
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-reuse',
        clientId: 'test-client',
        userId: 'user-1',
        scope: 'read',
        code,
        expiresAt: Date.now() + 600000,
      }));

      // First exchange - should succeed
      const response1 = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response1.status).toBe(200);
      const tokens1 = await response1.json();
      expect(tokens1).toHaveProperty('access_token');

      // Second exchange - should fail
      const response2 = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response2.status).toBe(400);
      const error = await response2.json() as any;
      expect(error.error).toBe('invalid_grant');
      expect(error.error_description).toContain('already been used');
    });

    it('should validate redirect_uri matches per RFC 6749 Section 4.1.3', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3 - redirect_uri MUST match
      const code = 'redirect-test';
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-redirect',
        clientId: 'test-client',
        userId: 'user-1',
        scope: 'read',
        code,
        redirectUri: 'http://localhost:3000/callback',
        expiresAt: Date.now() + 600000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-secret',
          redirect_uri: 'http://localhost:3000/different', // Wrong URI
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_grant');
    });
  });

  describe('Refresh Token Grant', () => {
    it('should refresh tokens with valid refresh token', async () => {
      // Create initial tokens
      const refreshToken = 'refresh-token-123';
      const refreshTokenHash = await hashToken(refreshToken);
      // Store with hash as the handler expects
      await storage.put(`refresh:${refreshTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read write',
        grantId: 'grant-123',
        createdAt: Date.now(),
        expiresAt: Date.now() + 7776000000, // 90 days
      }));


      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      if (response.status !== 200) {
        const error = await response.json() as any;
        console.log('Refresh token error:', error);
      }
      expect(response.status).toBe(200);
      const tokens = await response.json() as any;
      
      expect(tokens).toHaveProperty('access_token');
      expect(tokens).toHaveProperty('refresh_token');
      expect(tokens.refresh_token).not.toBe(refreshToken); // Should rotate
      expect(tokens.expires_in).toBe(3600);
    });

    it('should invalidate old refresh token after use per OAuth 2.1 Section 6.1', async () => {
      // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Refresh token rotation
      const oldRefreshToken = 'old-refresh-123';
      const oldRefreshTokenHash = await hashToken(oldRefreshToken);
      await storage.put(`refresh:${oldRefreshTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-123',
        createdAt: Date.now(),
        expiresAt: Date.now() + 7776000000, // 90 days
      }));


      // First refresh - should succeed
      const response1 = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: oldRefreshToken,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response1.status).toBe(200);
      const tokens1 = await response1.json() as any;
      const newRefreshToken = tokens1.refresh_token;

      // Try to use old refresh token - should fail
      const response2 = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: oldRefreshToken,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response2.status).toBe(400);
      const error = await response2.json() as any;
      expect(error.error).toBe('invalid_grant');
    });

    it('should reject expired refresh token', async () => {
      const expiredToken = 'expired-refresh';
      const expiredTokenHash = await hashToken(expiredToken);
      await storage.put(`refresh:${expiredTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-expired',
        createdAt: Date.now() - 2000,
        expiresAt: Date.now() - 1000, // Already expired
      }));


      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: expiredToken,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_grant');
      expect(error.error_description).toContain('expired');
    });

    it('should validate client ownership of refresh token', async () => {
      // Create refresh token for different client
      const refreshToken = 'other-client-token';
      const refreshTokenHash = await hashToken(refreshToken);
      await storage.put(`refresh:${refreshTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'other-client',
        scope: 'read',
        grantId: 'grant-other',
        createdAt: Date.now(),
        expiresAt: Date.now() + 7776000000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_grant');
    });
  });

  describe('Invalid Grant Types', () => {
    it('should reject unsupported grant types', async () => {
      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password', // Not supported in OAuth 2.1
          username: 'user',
          password: 'pass',
          client_id: 'test-client',
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_request');
    });

    it('should reject implicit grant attempts', async () => {
      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'implicit',
          client_id: 'test-client',
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_request');
    });
  });
});