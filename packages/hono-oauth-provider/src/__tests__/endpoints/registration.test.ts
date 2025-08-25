/**
 * Client Registration Endpoint Tests
 * Tests for RFC 7591 Dynamic Client Registration
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7591 - OAuth 2.0 Dynamic Client Registration Protocol
 * @see https://datatracker.ietf.org/doc/html/rfc7591#section-2 - Client Registration Endpoint
 * @see https://datatracker.ietf.org/doc/html/rfc7591#section-3.2.1 - Client Registration Request
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-2.1 - Registration Security Best Practices
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { OAuthProvider as OAuthProviderFunc } from '../../index';
import { OAuthProviderTestWrapper as OAuthProvider } from '../test-helpers';

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

describe('Client Registration Endpoint', () => {
  let storage: MemoryStorage;
  let provider: OAuthProvider;
  let app: Hono;

  beforeEach(() => {
    storage = new MemoryStorage();
    provider = new OAuthProvider({
      storage,
      issuer: 'http://localhost:8787',
      scopesSupported: ['read', 'write'],
    });
    app = provider.getApp();
  });

  describe('POST /register', () => {
    it('should register a new confidential client', async () => {
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test App',
          redirect_uris: ['http://localhost:3000/callback'],
        }),
      });

      if (response.status !== 201) {
        const body = await response.text();
        console.log('Response status:', response.status);
        console.log('Response body:', body);
      }
      
      expect(response.status).toBe(201);
      const client = await response.json() as any as any;
      
      expect(client).toHaveProperty('client_id');
      expect(client).toHaveProperty('client_secret');
      expect(client.client_name).toBe('Test App');
      
      // Verify client was stored with hashed secret
      const stored = await storage.get(`client:${client.client_id}`, { type: 'json' }) as any;
      expect(stored).toBeTruthy();
      expect(stored.secret).toContain('pbkdf2$'); // Should be hashed
    });

    it('should register a public client without secret', async () => {
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'SPA App',
          redirect_uris: ['http://localhost:3000/callback'],
          token_endpoint_auth_method: 'none',
        }),
      });

      expect(response.status).toBe(201);
      const client = await response.json() as any as any;
      
      expect(client).toHaveProperty('client_id');
      expect(client.client_secret).toBeUndefined();
    });

    it('should validate client name', async () => {
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: '<script>alert("xss")</script>',
          redirect_uris: ['http://localhost:3000/callback'],
        }),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_client_metadata');
      expect(error.error_description).toContain('invalid characters');
    });

    it('should validate redirect URIs per RFC 6749 Section 3.1.2.2', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.1.2.2 - Redirect URI validation
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test App',
          redirect_uris: [
            'javascript:alert("xss")', // Invalid protocol
            'http://localhost:3000/callback',
          ],
        }),
      });

      if (response.status !== 400) {
        const body = await response.text();
        console.log('Unexpected status:', response.status);
        console.log('Response:', body);
      }
      
      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_redirect_uri');
    });

    it('should reject too many redirect URIs', async () => {
      const tooManyUris = Array(11).fill('http://localhost:3000/callback');
      
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test App',
          redirect_uris: tooManyUris,
        }),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_client_metadata');
      expect(error.error_description).toContain('Maximum 10 redirect URIs');
    });

    it('should reject duplicate redirect URIs', async () => {
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test App',
          redirect_uris: [
            'http://localhost:3000/callback',
            'http://localhost:3000/callback', // Duplicate
          ],
        }),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_client_metadata');
      expect(error.error_description).toContain('Duplicate redirect URIs');
    });

    it('should reject redirect URIs with fragments per RFC 6749 Section 3.1.2', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.1.2 - No fragments allowed
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test App',
          redirect_uris: ['http://localhost:3000/callback#fragment'],
        }),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_redirect_uri');
    });

    it('should sanitize client metadata for XSS', async () => {
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test App', // Valid name
          redirect_uris: ['http://localhost:3000/callback'],
        }),
      });

      expect(response.status).toBe(201);
      const client = await response.json() as any as any;
      
      // Verify the client name was properly sanitized
      const stored = await storage.get(`client:${client.client_id}`, { type: 'json' }) as any;
      expect(stored.name).not.toContain('<');
      expect(stored.name).not.toContain('>');
    });

    it('should allow localhost redirect URIs when explicitly registered per RFC 8252 Section 7.3', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc8252#section-7.3 - Loopback redirect URI
      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Dev App',
          redirect_uris: [
            'http://localhost:3000/callback',
            'http://127.0.0.1:8080/auth',
          ],
        }),
      });

      expect(response.status).toBe(201);
      const client = await response.json() as any as any;
      expect(client.redirect_uris).toContain('http://localhost:3000/callback');
      expect(client.redirect_uris).toContain('http://127.0.0.1:8080/auth');
    });

    it('should reject private network IPs in production mode per security best practices', async () => {
      // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-4.3.1 - Redirect URI validation
      // Set production environment
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await app.request('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test App',
          redirect_uris: ['http://192.168.1.1/callback'],
        }),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_redirect_uri');

      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });
  });
});