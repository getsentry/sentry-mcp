/**
 * User Consent Management Tests
 * Tests for OAuth 2.1 consent storage and management
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-10.2 - Client Impersonation
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-9.1 - Security Considerations
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

describe('User Consent Management', () => {
  let storage: MemoryStorage;
  let provider: OAuthProvider;
  let app: Hono;

  beforeEach(async () => {
    storage = new MemoryStorage();
    provider = new OAuthProvider({
      storage,
      issuer: 'http://localhost:8787',
      scopesSupported: ['read', 'write'],
      strictMode: false, // Allow localhost for testing
    });
    app = provider.getApp();

    // Pre-register a test client with hashed secret
    const hashedSecret = await hashClientSecret('test-secret');
    await storage.put('client:test-client', JSON.stringify({
      id: 'test-client',
      secret: hashedSecret,
      name: 'Test Application',
      redirectUris: ['http://localhost:3000/callback'],
    }));
  });

  describe('Consent Flow', () => {
    it('should skip consent screen if valid consent exists', async () => {
      // Pre-store consent for the user
      await storage.put('consent:user-1:test-client', JSON.stringify({
        id: 'consent_123',
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantedAt: Date.now(),
        expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000, // 90 days
        lastUsedAt: Date.now(),
        useCount: 1,
        autoRenew: true,
      }));

      // Make authorization request
      const response = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
      }));

      // Should redirect immediately with code (no consent form)
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('code=');
      expect(location).toContain('state=test-state');
      expect(location).not.toContain('error');
    });

    it('should show consent screen for first-time authorization', async () => {
      // No existing consent

      const response = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
      }));

      // Should return consent form
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Authorization Request');
      expect(html).toContain('Test Application');
      expect(html).toContain('is requesting access to your account');
      expect(html).toContain('Your authorization will be remembered for 90 days');
    });

    it('should require re-consent for new scopes', async () => {
      // Pre-store consent for 'read' scope only
      await storage.put('consent:user-1:test-client', JSON.stringify({
        id: 'consent_123',
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantedAt: Date.now(),
        expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
        lastUsedAt: Date.now(),
        useCount: 1,
        autoRenew: true,
      }));

      // Request 'write' scope
      const response = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read write', // Requesting additional scope
        state: 'test-state',
      }));

      // Should show consent form for new scope
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Authorization Request');
    });

    it('should not use expired consent', async () => {
      // Pre-store expired consent
      await storage.put('consent:user-1:test-client', JSON.stringify({
        id: 'consent_expired',
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantedAt: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days ago
        expiresAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // Expired 10 days ago
        lastUsedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
        useCount: 1,
        autoRenew: false,
      }));

      const response = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
      }));

      // Should show consent form (expired consent not used)
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Authorization Request');

      // Expired consent should be cleaned up
      const consent = await storage.get('consent:user-1:test-client');
      expect(consent).toBeNull();
    });

    it('should store consent when user approves', async () => {
      // Get consent form first
      const getResponse = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
      }));

      const html = await getResponse.text();
      const csrfMatch = html.match(/name="csrf_token" value="([^"]+)"/);
      const csrfToken = csrfMatch?.[1];

      // Submit approval
      const formData = new FormData();
      formData.append('action', 'approve');
      formData.append('csrf_token', csrfToken!);
      formData.append('client_id', 'test-client');
      formData.append('redirect_uri', 'http://localhost:3000/callback');
      formData.append('scope', 'read');
      formData.append('state', 'test-state');

      const postResponse = await app.request('/authorize', {
        method: 'POST',
        body: formData,
      });

      expect(postResponse.status).toBe(302);

      // Check consent was stored
      const consent = await storage.get('consent:user-1:test-client', { type: 'json' }) as any;
      expect(consent).toBeTruthy();
      expect(consent.userId).toBe('user-1');
      expect(consent.clientId).toBe('test-client');
      expect(consent.scope).toBe('read');
      expect(consent.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('Consent Management Endpoints', () => {
    let accessToken: string;

    beforeEach(async () => {
      // Create an access token for authentication
      accessToken = 'test-access-token';
      await storage.put(`token:${accessToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-test',
        expiresAt: Date.now() + 3600000, // 1 hour
      }));
      // Pre-store some consents
      await storage.put('consent:user-1:test-client', JSON.stringify({
        id: 'consent_1',
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantedAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
        expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000, // 60 days left
        lastUsedAt: Date.now() - 5 * 24 * 60 * 60 * 1000, // Used 5 days ago
        useCount: 10,
        autoRenew: true,
      }));

      await storage.put('consent:user-1:another-client', JSON.stringify({
        id: 'consent_2',
        userId: 'user-1',
        clientId: 'another-client',
        scope: 'write',
        grantedAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days ago
        expiresAt: Date.now() + 80 * 24 * 60 * 60 * 1000, // 80 days left
        lastUsedAt: Date.now(),
        useCount: 3,
        autoRenew: true,
      }));
    });

    it('should list user consents with valid Bearer token', async () => {
      const response = await app.request('/consents', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      
      expect(response.status).toBe(200);
      const data = await response.json() as any;
      
      expect(data.count).toBe(2);
      expect(data.consents).toHaveLength(2);
      
      const testClientConsent = data.consents.find((c: any) => c.clientId === 'test-client');
      expect(testClientConsent).toBeTruthy();
      expect(testClientConsent.clientName).toBe('Test Application');
      expect(testClientConsent.scope).toBe('read');
      expect(testClientConsent.useCount).toBe(10);
    });

    it('should revoke consent for specific client with valid Bearer token', async () => {
      const response = await app.request('/consents/test-client', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      
      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.message).toContain('test-client');
      
      // Verify consent was deleted
      const consent = await storage.get('consent:user-1:test-client');
      expect(consent).toBeNull();
      
      // Other consent should still exist
      const otherConsent = await storage.get('consent:user-1:another-client');
      expect(otherConsent).toBeTruthy();
    });

    it('should revoke all consents with valid Bearer token', async () => {
      const response = await app.request('/consents', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      
      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.message).toContain('All consents');
      
      // Verify all consents were deleted
      const consent1 = await storage.get('consent:user-1:test-client');
      const consent2 = await storage.get('consent:user-1:another-client');
      expect(consent1).toBeNull();
      expect(consent2).toBeNull();
    });

    it('should return empty list when no consents exist', async () => {
      // Delete all consents first
      await storage.delete('consent:user-1:test-client');
      await storage.delete('consent:user-1:another-client');
      
      const response = await app.request('/consents', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      
      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.count).toBe(0);
      expect(data.consents).toHaveLength(0);
    });

    it('should handle revoke for non-existent client', async () => {
      const response = await app.request('/consents/non-existent', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      
      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      // Should succeed silently even if consent doesn't exist
    });

    it('should reject requests without Bearer token', async () => {
      const response = await app.request('/consents');
      
      expect(response.status).toBe(401);
      const data = await response.json() as any;
      expect(data.error).toBe('unauthorized');
      expect(data.error_description).toContain('Bearer token required');
    });

    it('should reject requests with invalid Bearer token', async () => {
      const response = await app.request('/consents', {
        headers: {
          'Authorization': 'Bearer invalid-token',
        },
      });
      
      expect(response.status).toBe(401);
      const data = await response.json() as any;
      expect(data.error).toBe('invalid_token');
    });

    it('should reject requests with expired Bearer token', async () => {
      // Create expired token
      const expiredToken = 'expired-token';
      await storage.put(`token:${expiredToken}`, JSON.stringify({
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantId: 'grant-expired',
        expiresAt: Date.now() - 1000, // Already expired
      }));

      const response = await app.request('/consents', {
        headers: {
          'Authorization': `Bearer ${expiredToken}`,
        },
      });
      
      expect(response.status).toBe(401);
      const data = await response.json() as any;
      expect(data.error).toBe('invalid_token');
    });
  });

  describe('Consent Auto-Renewal', () => {
    it('should auto-renew consent when used within renewal window', async () => {
      const now = Date.now();
      const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000;
      
      // Store consent that expires in 30 days (within renewal window)
      await storage.put('consent:user-1:test-client', JSON.stringify({
        id: 'consent_renew',
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantedAt: now - 60 * 24 * 60 * 60 * 1000, // 60 days ago
        expiresAt: thirtyDaysFromNow,
        lastUsedAt: now - 5 * 24 * 60 * 60 * 1000,
        useCount: 5,
        autoRenew: true,
      }));

      // Use the consent
      const response = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
      }));

      expect(response.status).toBe(302);

      // Check consent was renewed
      const consent = await storage.get('consent:user-1:test-client', { type: 'json' }) as any;
      expect(consent.expiresAt).toBeGreaterThan(thirtyDaysFromNow);
      expect(consent.lastUsedAt).toBeGreaterThanOrEqual(now);
      expect(consent.useCount).toBe(6);
    });

    it('should respect maximum consent lifetime', async () => {
      const now = Date.now();
      const yearAgo = now - 350 * 24 * 60 * 60 * 1000;
      
      // Store consent granted almost a year ago
      await storage.put('consent:user-1:test-client', JSON.stringify({
        id: 'consent_max',
        userId: 'user-1',
        clientId: 'test-client',
        scope: 'read',
        grantedAt: yearAgo,
        expiresAt: now + 10 * 24 * 60 * 60 * 1000, // Expires in 10 days
        lastUsedAt: now - 1 * 24 * 60 * 60 * 1000,
        useCount: 100,
        autoRenew: true,
      }));

      // Use the consent
      await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
      }));

      // Check consent was renewed but capped at max lifetime
      const consent = await storage.get('consent:user-1:test-client', { type: 'json' }) as any;
      const maxLifetime = yearAgo + 365 * 24 * 60 * 60 * 1000; // 1 year from grant
      expect(consent.expiresAt).toBeLessThanOrEqual(maxLifetime);
    });
  });
});