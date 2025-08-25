/**
 * Tests for OAuth 2.1 compliant redirect_uri handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { OAuthProviderTestWrapper as OAuthProvider } from '../test-helpers';
import type { Storage, Client } from '../../types';

class TestStorage implements Storage {
  private store = new Map<string, any>();

  async get(key: string): Promise<string | null>;
  async get<T>(key: string, options: { type: 'json' }): Promise<T | null>;
  async get(key: string, options?: { type?: string }): Promise<any> {
    const value = this.store.get(key);
    if (!value) return null;
    
    if (options?.type === 'json') {
      return typeof value === 'string' ? JSON.parse(value) : value;
    }
    return value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
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

describe('OAuth 2.1 Redirect URI Security', () => {
  let storage: TestStorage;
  let provider: OAuthProvider;
  let app: Hono;

  beforeEach(() => {
    storage = new TestStorage();
    provider = new OAuthProvider({
      storage,
      issuer: 'http://localhost:8787',
      scopesSupported: ['read', 'write'],
      strictMode: true,
    });
    app = provider.getApp();
  });

  describe('Invalid redirect_uri handling', () => {
    it('should NOT redirect when redirect_uri is invalid (OAuth 2.1 compliance)', async () => {
      // Setup client with specific redirect URIs
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: [
          'http://localhost:3000/callback',
          'http://localhost:3000/auth/callback',
        ],
      };
      await storage.put('client:test-client', JSON.stringify(client));

      // Try with an invalid redirect_uri
      const url = new URL('http://localhost:8787/authorize');
      url.searchParams.set('client_id', 'test-client');
      url.searchParams.set('redirect_uri', 'http://evil.com/steal-token');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', 'test-state-123');

      const response = await app.request(url.toString());

      // Should NOT redirect (no Location header)
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      
      // Should return HTML error page
      expect(response.headers.get('content-type')).toContain('text/html');
      
      const html = await response.text();
      expect(html).toContain('Invalid Request');
      expect(html).toContain('redirect_uri parameter does not match');
      expect(html).not.toContain('http://evil.com'); // Don't leak the invalid URI
    });

    it('should NOT redirect even if state parameter is provided', async () => {
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: ['http://localhost:3000/callback'],
      };
      await storage.put('client:test-client', JSON.stringify(client));

      const url = new URL('http://localhost:8787/authorize');
      url.searchParams.set('client_id', 'test-client');
      url.searchParams.set('redirect_uri', 'http://malicious.com/callback');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', 'user-state-456'); // State should not cause redirect

      const response = await app.request(url.toString());

      // Must not redirect despite state parameter
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      
      const html = await response.text();
      expect(html).toContain('Invalid Request');
    });

    it('should allow exact matching redirect_uri', async () => {
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: [
          'http://localhost:3000/callback',
          'https://app.example.com/oauth/callback',
        ],
      };
      await storage.put('client:test-client', JSON.stringify(client));

      // Test each valid redirect URI
      for (const validUri of client.redirectUris) {
        const url = new URL('http://localhost:8787/authorize');
        url.searchParams.set('client_id', 'test-client');
        url.searchParams.set('redirect_uri', validUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('code_challenge', 'test-challenge');
        url.searchParams.set('code_challenge_method', 'S256');

        const response = await app.request(url.toString());

        // Should show consent form, not error
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('<form');
        expect(html).not.toContain('Invalid Request');
      }
    });

    it('should reject redirect_uri with different scheme', async () => {
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: ['https://app.example.com/callback'], // HTTPS
      };
      await storage.put('client:test-client', JSON.stringify(client));

      const url = new URL('http://localhost:8787/authorize');
      url.searchParams.set('client_id', 'test-client');
      url.searchParams.set('redirect_uri', 'http://app.example.com/callback'); // HTTP instead
      url.searchParams.set('response_type', 'code');

      const response = await app.request(url.toString());

      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      const html = await response.text();
      expect(html).toContain('Invalid Request');
    });

    it('should reject redirect_uri with different port', async () => {
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: ['http://localhost:3000/callback'],
      };
      await storage.put('client:test-client', JSON.stringify(client));

      const url = new URL('http://localhost:8787/authorize');
      url.searchParams.set('client_id', 'test-client');
      url.searchParams.set('redirect_uri', 'http://localhost:3001/callback'); // Different port
      url.searchParams.set('response_type', 'code');

      const response = await app.request(url.toString());

      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
    });

    it('should reject redirect_uri with additional path segments', async () => {
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: ['http://localhost:3000/callback'],
      };
      await storage.put('client:test-client', JSON.stringify(client));

      const url = new URL('http://localhost:8787/authorize');
      url.searchParams.set('client_id', 'test-client');
      url.searchParams.set('redirect_uri', 'http://localhost:3000/callback/extra'); // Extra path
      url.searchParams.set('response_type', 'code');

      const response = await app.request(url.toString());

      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
    });

    it('should reject redirect_uri with query parameters not in registration', async () => {
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: ['http://localhost:3000/callback'],
      };
      await storage.put('client:test-client', JSON.stringify(client));

      const url = new URL('http://localhost:8787/authorize');
      url.searchParams.set('client_id', 'test-client');
      url.searchParams.set('redirect_uri', 'http://localhost:3000/callback?extra=param');
      url.searchParams.set('response_type', 'code');

      const response = await app.request(url.toString());

      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
    });

    it('should handle missing redirect_uri parameter', async () => {
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: ['http://localhost:3000/callback'],
      };
      await storage.put('client:test-client', JSON.stringify(client));

      const url = new URL('http://localhost:8787/authorize');
      url.searchParams.set('client_id', 'test-client');
      // Missing redirect_uri parameter
      url.searchParams.set('response_type', 'code');

      const response = await app.request(url.toString());

      // Should return error (Zod validation will catch this)
      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBe('invalid_request');
    });
  });

  describe('Valid redirect scenarios', () => {
    it('should redirect with error when other validations fail but redirect_uri is valid', async () => {
      const client: Client = {
        id: 'test-client',
        name: 'Test Application',
        redirectUris: ['http://localhost:3000/callback'],
        // Public client (no secret)
      };
      await storage.put('client:test-client', JSON.stringify(client));

      const url = new URL('http://localhost:8787/authorize');
      url.searchParams.set('client_id', 'test-client');
      url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      url.searchParams.set('response_type', 'code');
      // Missing PKCE for public client in strict mode

      const response = await app.request(url.toString());

      // Should redirect with error (redirect_uri is valid)
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).toContain('http://localhost:3000/callback');
      expect(location).toContain('error=invalid_request');
      expect(location).toContain('PKCE+is+required+for+public+clients');
    });
  });
});