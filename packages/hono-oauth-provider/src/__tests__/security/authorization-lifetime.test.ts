/**
 * Maximum Authorization Lifetime Tests
 * Tests for OAuth 2.1 authorization lifetime limits
 * 
 * Security best practice: Limit the total lifetime of an authorization grant
 * to prevent indefinite access. Even with refresh token rotation, authorizations
 * should have a maximum lifetime after which users must re-authenticate.
 * 
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-4.13 - Refresh Token Protection
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Refresh Token Security
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

describe('Maximum Authorization Lifetime', () => {
  let storage: MemoryStorage;
  let provider: OAuthProvider;
  let app: Hono;

  beforeEach(async () => {
    storage = new MemoryStorage();
    
    // Pre-register a test client with hashed secret
    const hashedSecret = await hashClientSecret('test-secret');
    await storage.put('client:test-client', JSON.stringify({
      id: 'test-client',
      secret: hashedSecret,
      name: 'Test Client',
      redirectUris: ['http://localhost:3000/callback'],
    }));
  });

  describe('Authorization Code Exchange', () => {
    it('should reject authorization code exchange after maximum lifetime', async () => {
      // Create provider with short max lifetime for testing
      provider = new OAuthProvider({
        storage,
        issuer: 'http://localhost:8787',
        scopesSupported: ['read', 'write'],
        maxAuthorizationLifetime: 100, // 100ms for testing
      });
      app = provider.getApp();

      const code = 'old-code';
      const yearAgo = Date.now() - 366 * 24 * 60 * 60 * 1000; // Over 1 year ago
      
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-old',
        clientId: 'test-client',
        userId: 'user-1',
        scope: 'read',
        code,
        expiresAt: Date.now() + 600000, // Still valid code expiry
        createdAt: yearAgo, // But created over max lifetime ago
      }));

      // Wait to exceed max lifetime
      await new Promise(resolve => setTimeout(resolve, 150));

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
      expect(error.error_description).toContain('maximum lifetime');
    });

    it('should allow authorization code exchange within maximum lifetime', async () => {
      // Create provider with default max lifetime
      provider = new OAuthProvider({
        storage,
        issuer: 'http://localhost:8787',
        scopesSupported: ['read', 'write'],
      });
      app = provider.getApp();

      const code = 'fresh-code';
      
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-fresh',
        clientId: 'test-client',
        userId: 'user-1',
        scope: 'read',
        code,
        expiresAt: Date.now() + 600000,
        createdAt: Date.now() - 1000, // Just created
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

      expect(response.status).toBe(200);
      const tokens = await response.json() as any;
      expect(tokens).toHaveProperty('access_token');
      expect(tokens).toHaveProperty('refresh_token');
    });
  });

  describe('Refresh Token Usage', () => {
    it('should reject refresh token after maximum authorization lifetime per OAuth 2.1 Section 6.1', async () => {
      // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-6.1 - Refresh Token Security
      // Create provider with short max lifetime for testing
      provider = new OAuthProvider({
        storage,
        issuer: 'http://localhost:8787',
        scopesSupported: ['read', 'write'],
        strictMode: true, // Enable refresh token rotation
        maxAuthorizationLifetime: 100, // 100ms for testing
      });
      app = provider.getApp();

      const refreshToken = 'old-refresh';
      const yearAgo = Date.now() - 366 * 24 * 60 * 60 * 1000;
      
      const refreshTokenHash = await hashToken(refreshToken);
      await storage.put(`refresh:${refreshTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-old',
        createdAt: yearAgo, // Original grant created over max lifetime ago
      }));

      // Wait to exceed max lifetime
      await new Promise(resolve => setTimeout(resolve, 150));

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
      expect(error.error_description).toContain('maximum lifetime');
      
      // Verify refresh token was deleted
      const deletedTokenHash = await hashToken(refreshToken);
      const deletedToken = await storage.get(`refresh:${deletedTokenHash}`);
      expect(deletedToken).toBeNull();
    });

    it('should allow refresh token within maximum authorization lifetime', async () => {
      provider = new OAuthProvider({
        storage,
        issuer: 'http://localhost:8787',
        scopesSupported: ['read', 'write'],
        strictMode: true,
      });
      app = provider.getApp();

      const refreshToken = 'fresh-refresh';
      
      const refreshTokenHash = await hashToken(refreshToken);
      await storage.put(`refresh:${refreshTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-fresh',
        createdAt: Date.now() - 60000, // Created 1 minute ago
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

      expect(response.status).toBe(200);
      const tokens = await response.json() as any;
      expect(tokens).toHaveProperty('access_token');
      expect(tokens).toHaveProperty('refresh_token');
    });

    it('should preserve original grant creation time through refresh token rotations', async () => {
      provider = new OAuthProvider({
        storage,
        issuer: 'http://localhost:8787',
        scopesSupported: ['read', 'write'],
        strictMode: true,
      });
      app = provider.getApp();

      const originalCreatedAt = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
      let currentRefreshToken = 'refresh-1';
      
      // Store initial refresh token
      const currentRefreshTokenHash = await hashToken(currentRefreshToken);
      await storage.put(`refresh:${currentRefreshTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-123',
        createdAt: originalCreatedAt,
      }));

      // Perform multiple refresh token rotations
      for (let i = 0; i < 3; i++) {
        const response = await app.request('/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: currentRefreshToken,
            client_id: 'test-client',
            client_secret: 'test-secret',
          }).toString(),
        });

        expect(response.status).toBe(200);
        const tokens = await response.json() as any;
        
        // Get the new refresh token
        currentRefreshToken = tokens.refresh_token;
        expect(currentRefreshToken).not.toBe(`refresh-${i + 1}`);
        
        // Verify createdAt is preserved
        const newRefreshTokenHash = await hashToken(currentRefreshToken);
        const newRefreshData = await storage.get(`refresh:${newRefreshTokenHash}`, { type: 'json' }) as any;
        expect(newRefreshData?.createdAt).toBe(originalCreatedAt);
      }
    });

    it('should always require createdAt field in refresh tokens', async () => {
      provider = new OAuthProvider({
        storage,
        issuer: 'http://localhost:8787',
        scopesSupported: ['read', 'write'],
        strictMode: true,
      });
      app = provider.getApp();

      const refreshToken = 'valid-refresh';
      
      // Store refresh token with createdAt (always required)
      const refreshTokenHash = await hashToken(refreshToken);
      await storage.put(`refresh:${refreshTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-valid',
        createdAt: Date.now(), // Always required
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

      expect(response.status).toBe(200);
      const tokens = await response.json() as any;
      expect(tokens).toHaveProperty('access_token');
      
      // Verify new refresh token has createdAt
      const newRefreshTokenHash = await hashToken(tokens.refresh_token);
      const newRefreshData = await storage.get(`refresh:${newRefreshTokenHash}`, { type: 'json' }) as any;
      expect(newRefreshData?.createdAt).toBeDefined();
      expect(newRefreshData?.createdAt).toBeLessThanOrEqual(Date.now()); // Recent
    });
  });

  describe('Configuration', () => {
    it('should use default maximum lifetime when not configured', async () => {
      provider = new OAuthProvider({
        storage,
        issuer: 'http://localhost:8787',
        scopesSupported: ['read', 'write'],
        // No maxAuthorizationLifetime specified
      });
      app = provider.getApp();

      // Default should be 1 year (31536000000 ms)
      const code = 'test-code';
      const elevenMonthsAgo = Date.now() - 330 * 24 * 60 * 60 * 1000;
      
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-11mo',
        clientId: 'test-client',
        userId: 'user-1',
        scope: 'read',
        code,
        expiresAt: Date.now() + 600000,
        createdAt: elevenMonthsAgo, // Within default 1 year
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

      expect(response.status).toBe(200); // Should succeed within 1 year
    });

    it('should respect custom maximum lifetime configuration', async () => {
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      
      provider = new OAuthProvider({
        storage,
        issuer: 'http://localhost:8787',
        scopesSupported: ['read', 'write'],
        maxAuthorizationLifetime: oneWeekMs, // 1 week
      });
      app = provider.getApp();

      const refreshToken = 'week-old';
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      
      const refreshTokenHash = await hashToken(refreshToken);
      await storage.put(`refresh:${refreshTokenHash}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-week',
        createdAt: eightDaysAgo, // Over 1 week
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
      expect(error.error_description).toContain('maximum lifetime');
    });
  });
});