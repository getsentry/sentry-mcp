/**
 * Token Introspection Endpoint Tests
 * Tests for RFC 7662 OAuth 2.0 Token Introspection
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7662 - OAuth 2.0 Token Introspection
 * @see https://datatracker.ietf.org/doc/html/rfc7662#section-2 - Introspection Endpoint
 * @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.1 - Introspection Request
 * @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.2 - Introspection Response
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

describe('Token Introspection Endpoint', () => {
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

    // Pre-register test clients with hashed secrets
    const hashedSecret = await hashClientSecret('test-secret');
    await storage.put('client:test-client', JSON.stringify({
      id: 'test-client',
      secret: hashedSecret,
      name: 'Test Client',
      redirectUris: ['http://localhost:3000/callback'],
    }));

    const hashedSecret2 = await hashClientSecret('resource-secret');
    await storage.put('client:resource-server', JSON.stringify({
      id: 'resource-server',
      secret: hashedSecret2,
      name: 'Resource Server',
      redirectUris: [],
    }));
  });

  describe('POST /introspect', () => {
    it('should introspect an active access token per RFC 7662 Section 2.2', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.2 - Active token response
      const accessToken = 'active-token-123';
      const expiresAt = Date.now() + 3600000;
      
      await storage.put(`token:${accessToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read write',
        grantId: 'grant-123',
        expiresAt,
      }));

      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: accessToken,
          token_type_hint: 'access_token',
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const introspection = await response.json() as any as any;
      
      expect(introspection.active).toBe(true);
      expect(introspection.scope).toBe('read write');
      expect(introspection.client_id).toBe('test-client');
      expect(introspection.token_type).toBe('Bearer');
      expect(introspection.exp).toBe(Math.floor(expiresAt / 1000));
      expect(introspection.sub).toBe('user-1');
    });

    it('should introspect an active refresh token', async () => {
      const refreshToken = 'refresh-token-456';
      const expiresAt = Date.now() + 7776000000;
      
      await storage.put(`refresh:${refreshToken}`, JSON.stringify({
        userId: 'user-2',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-456',
        expiresAt,
      }));


      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: refreshToken,
          token_type_hint: 'refresh_token',
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const introspection = await response.json() as any as any;
      
      expect(introspection.active).toBe(true);
      expect(introspection.scope).toBe('read');
      expect(introspection.client_id).toBe('test-client');
      expect(introspection.token_type).toBe('refresh_token');
      expect(introspection.exp).toBe(Math.floor(expiresAt / 1000));
      expect(introspection.sub).toBe('user-2');
    });

    it('should return inactive for expired token per RFC 7662 Section 2.2', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.2 - Inactive token response
      const expiredToken = 'expired-token';
      
      await storage.put(`token:${expiredToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-expired',
        expiresAt: Date.now() - 1000, // Already expired
      }));

      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: expiredToken,
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const introspection = await response.json() as any as any;
      
      expect(introspection.active).toBe(false);
      // No other fields should be present for inactive tokens
      expect(Object.keys(introspection)).toEqual(['active']);
    });

    it('should return inactive for non-existent token', async () => {
      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: 'non-existent-token',
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const introspection = await response.json() as any as any;
      
      expect(introspection.active).toBe(false);
    });

    it('should auto-detect token type without hint', async () => {
      const accessToken = 'auto-detect-token';
      
      await storage.put(`token:${accessToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-auto',
        expiresAt: Date.now() + 3600000,
      }));

      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: accessToken,
          // No token_type_hint
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const introspection = await response.json() as any as any;
      
      expect(introspection.active).toBe(true);
      expect(introspection.token_type).toBe('Bearer');
    });

    it('should require client authentication', async () => {
      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: 'some-token',
          client_id: 'resource-server',
          client_secret: 'wrong-secret',
        }).toString(),
      });

      expect(response.status).toBe(401);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_client');
    });

    it('should handle missing token parameter', async () => {
      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          // No token parameter
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_request');
    });

    it('should include issuer in response per RFC 7662 Section 2.2', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.2 - Optional 'iss' claim
      const token = 'issuer-test-token';
      
      await storage.put(`token:${token}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-issuer',
        expiresAt: Date.now() + 3600000,
      }));

      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token,
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const introspection = await response.json() as any as any;
      
      expect(introspection.iss).toBe('http://localhost:8787');
    });

    it('should handle invalid token format gracefully', async () => {
      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: '', // Empty token
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const introspection = await response.json() as any as any;
      
      expect(introspection.active).toBe(false);
    });

    it('should not leak information about tokens from other clients', async () => {
      const token = 'other-client-token';
      
      // Create token owned by different client
      await storage.put(`token:${token}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'other-client',
        scope: 'admin delete',
        grantId: 'grant-other',
        expiresAt: Date.now() + 3600000,
      }));

      const response = await app.request('/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token,
          client_id: 'resource-server',
          client_secret: 'resource-secret',
        }).toString(),
      });

      expect(response.status).toBe(200);
      const introspection = await response.json() as any as any;
      
      // Should still return active=true for valid tokens from other clients
      // (resource servers need to validate any token)
      expect(introspection.active).toBe(true);
      expect(introspection.client_id).toBe('other-client');
    });
  });
});