/**
 * Token Revocation Endpoint Tests
 * Tests for RFC 7009 OAuth 2.0 Token Revocation
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7009 - OAuth 2.0 Token Revocation
 * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2 - Revocation Endpoint
 * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.1 - Revocation Request
 * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.2 - Revocation Response
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { OAuthProvider as OAuthProviderFunc } from '../../index';
import { OAuthProviderTestWrapper as OAuthProvider } from '../test-helpers';
import { hashClientSecret } from '../../lib/crypto';

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

describe('Token Revocation Endpoint', () => {
  let storage: MemoryStorage;
  let provider: OAuthProvider;
  let app: Hono;

  beforeEach(async () => {
    storage = new MemoryStorage();
    provider = new OAuthProvider({
      storage,
      issuer: 'http://localhost:8787',
      scopesSupported: ['read', 'write'],
      strictMode: true, // Enable OAuth 2.1 strict mode
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

  describe('POST /revoke', () => {
    it('should revoke an access token', async () => {
      const accessToken = 'access-token-123';
      
      // Create a valid access token
      await storage.put(`token:${accessToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-123',
        expiresAt: Date.now() + 3600000,
      }));

      const response = await app.request('/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: accessToken,
          token_type_hint: 'access_token',
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.success).toBe(true);

      // Verify token was deleted
      const tokenData = await storage.get(`token:${accessToken}`);
      expect(tokenData).toBeNull();
    });

    it('should revoke a refresh token', async () => {
      const refreshToken = 'refresh-token-456';
      
      // Create a valid refresh token
      await storage.put(`refresh:${refreshToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-456',
      }));


      const response = await app.request('/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: refreshToken,
          token_type_hint: 'refresh_token',
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.success).toBe(true);

      // Verify refresh token was deleted
      const refreshData = await storage.get(`refresh:${refreshToken}`);
      expect(refreshData).toBeNull();
    });

    it('should auto-detect token type without hint', async () => {
      const accessToken = 'auto-detect-token';
      
      await storage.put(`token:${accessToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-auto',
      }));

      const response = await app.request('/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: accessToken,
          // No token_type_hint provided
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.success).toBe(true);

      // Verify token was deleted
      const tokenData = await storage.get(`token:${accessToken}`);
      expect(tokenData).toBeNull();
    });

    it('should require client authentication', async () => {
      const response = await app.request('/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: 'some-token',
          client_id: 'test-client',
          client_secret: 'wrong-secret',
        }).toString(),
      });

      expect(response.status).toBe(401);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_client');
    });

    it('should return success for non-existent tokens per RFC 7009 Section 2.2', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.2
      // The server responds with HTTP status 200 whether or not the token exists
      
      const response = await app.request('/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: 'non-existent-token',
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.success).toBe(true);
    });

    it('should handle invalid token format gracefully', async () => {
      const response = await app.request('/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: '', // Empty token
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.success).toBe(true);
    });

    it('should only revoke tokens owned by the authenticated client per RFC 7009 Section 2.1', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.1 - Client authentication required
      const accessToken = 'other-client-token';
      
      // Create a token owned by a different client
      await storage.put(`token:${accessToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'other-client',
        scope: 'read',
        grantId: 'grant-other',
      }));

      const response = await app.request('/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: accessToken,
          client_id: 'test-client',
          client_secret: 'test-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.success).toBe(true);

      // Token should NOT be deleted (owned by different client)
      const tokenData = await storage.get(`token:${accessToken}`);
      expect(tokenData).toBeTruthy();
    });

    it('should handle concurrent revocation attempts', async () => {
      const token = 'concurrent-token';
      
      await storage.put(`token:${token}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-concurrent',
      }));

      // Simulate concurrent revocation attempts
      const promises = Array(5).fill(null).map(() =>
        app.request('/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token,
            client_id: 'test-client',
            client_secret: 'test-secret',
          }).toString(),
        })
      );

      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Token should be deleted
      const tokenData = await storage.get(`token:${token}`);
      expect(tokenData).toBeNull();
    });
  });
});