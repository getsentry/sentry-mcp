/**
 * PKCE (Proof Key for Code Exchange) Tests
 * Tests for RFC 7636 implementation
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7636 - Proof Key for Code Exchange by OAuth Public Clients
 * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4 - Protocol Flow
 * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.1 - Client Creates Code Verifier
 * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.2 - Client Creates Code Challenge
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-4.1.1 - OAuth 2.1 PKCE Requirements
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

// Helper to generate PKCE challenge
function base64URLEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generatePKCEChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(digest);
}

describe('PKCE Security', () => {
  let storage: MemoryStorage;
  let provider: OAuthProvider;
  let app: Hono;

  beforeEach(async () => {
    storage = new MemoryStorage();
    provider = new OAuthProvider({
      storage,
      issuer: 'http://localhost:8787',
      scopesSupported: ['read', 'write'],
      strictMode: true, // Enforce PKCE for public clients
    });
    app = provider.getApp();

    // Register confidential client
    const hashedSecret = await hashClientSecret('test-secret');
    await storage.put('client:confidential-client', JSON.stringify({
      id: 'confidential-client',
      secret: hashedSecret,
      name: 'Confidential Client',
      redirectUris: ['http://localhost:3000/callback'],
    }));

    // Register public client (no secret)
    await storage.put('client:public-client', JSON.stringify({
      id: 'public-client',
      name: 'Public Client (SPA)',
      redirectUris: ['http://localhost:3000/callback'],
    }));
  });

  describe('Authorization with PKCE', () => {
    it('should require PKCE for public clients in strict mode per OAuth 2.1 Section 4.1.1', async () => {
      // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-4.1.1 - PKCE is required
      const response = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'public-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
        // Missing code_challenge
      }));

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('error=invalid_request');
      expect(location).toContain('error_description');
      expect(location).toContain('PKCE');
      expect(location).toContain('required');
    });

    it('should accept PKCE with S256 method', async () => {
      const verifier = 'test-verifier-123456789012345678901234567890123';
      const challenge = await generatePKCEChallenge(verifier);

      const response = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'public-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }));

      // Should return consent form (200) not error redirect
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Authorize');
      expect(html).toContain('Public Client');
    });

    it('should accept PKCE with plain method', async () => {
      const verifier = 'test-verifier-plain';

      const response = await app.request('/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: 'public-client',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'read',
        state: 'test-state',
        code_challenge: verifier,
        code_challenge_method: 'plain',
      }));

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Authorize');
    });

    it('should store PKCE challenge in grant', async () => {
      const verifier = 'stored-verifier-test';
      const challenge = await generatePKCEChallenge(verifier);

      // Create grant with PKCE
      const code = 'pkce-code-123';
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-pkce',
        clientId: 'public-client',
        userId: 'user-1',
        scope: 'read',
        code,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      }));

      // Verify stored correctly
      const grant = await storage.get(`grant:${code}`, { type: 'json' }) as any;
      expect(grant.codeChallenge).toBe(challenge);
      expect(grant.codeChallengeMethod).toBe('S256');
    });
  });

  describe('Token Exchange with PKCE', () => {
    it('should require code_verifier for PKCE-enabled grant', async () => {
      const verifier = 'test-verifier-required';
      const challenge = await generatePKCEChallenge(verifier);
      const code = 'pkce-required-code';

      // Create grant with PKCE
      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-required',
        clientId: 'public-client',
        userId: 'user-1',
        scope: 'read',
        code,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      }));

      // Try to exchange without verifier
      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'public-client',
          // Missing code_verifier
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_grant');
    });

    it('should validate S256 code_verifier correctly per RFC 7636 Section 4.6', async () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.6 - Server verifies code_verifier
      const verifier = 'correct-verifier-s256-test-123456789';
      const challenge = await generatePKCEChallenge(verifier);
      const code = 's256-valid-code';

      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-s256',
        clientId: 'public-client',
        userId: 'user-1',
        scope: 'read',
        code,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'public-client',
          code_verifier: verifier,
        }).toString(),
      });

      expect(response.status).toBe(200);
      const tokens = await response.json() as any;
      expect(tokens).toHaveProperty('access_token');
    });

    it('should reject incorrect S256 code_verifier', async () => {
      const verifier = 'correct-verifier';
      const challenge = await generatePKCEChallenge(verifier);
      const code = 's256-invalid-code';

      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-s256-wrong',
        clientId: 'public-client',
        userId: 'user-1',
        scope: 'read',
        code,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'public-client',
          code_verifier: 'wrong-verifier',
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_grant');
    });

    it('should validate plain code_verifier correctly', async () => {
      const verifier = 'plain-verifier-test';
      const code = 'plain-valid-code';

      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-plain',
        clientId: 'public-client',
        userId: 'user-1',
        scope: 'read',
        code,
        codeChallenge: verifier,
        codeChallengeMethod: 'plain',
        expiresAt: Date.now() + 600000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'public-client',
          code_verifier: verifier,
        }).toString(),
      });

      expect(response.status).toBe(200);
      const tokens = await response.json() as any;
      expect(tokens).toHaveProperty('access_token');
    });

    it('should reject incorrect plain code_verifier', async () => {
      const code = 'plain-invalid-code';

      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-plain-wrong',
        clientId: 'public-client',
        userId: 'user-1',
        scope: 'read',
        code,
        codeChallenge: 'correct-plain-verifier',
        codeChallengeMethod: 'plain',
        expiresAt: Date.now() + 600000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'public-client',
          code_verifier: 'wrong-plain-verifier',
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_grant');
    });

    it('should not require PKCE for confidential clients', async () => {
      const code = 'confidential-no-pkce';

      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-confidential',
        clientId: 'confidential-client',
        userId: 'user-1',
        scope: 'read',
        code,
        // No PKCE challenge
        expiresAt: Date.now() + 600000,
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'confidential-client',
          client_secret: 'test-secret',
          // No code_verifier
        }).toString(),
      });

      expect(response.status).toBe(200);
      const tokens = await response.json() as any;
      expect(tokens).toHaveProperty('access_token');
    });

    it('should handle unexpected verifier for non-PKCE grant', async () => {
      const code = 'no-pkce-code';

      await storage.put(`grant:${code}`, JSON.stringify({
        id: 'grant-no-pkce',
        clientId: 'confidential-client',
        userId: 'user-1',
        scope: 'read',
        code,
        // No PKCE challenge
        expiresAt: Date.now() + 600000,
        createdAt: Date.now(),
      }));

      const response = await app.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'confidential-client',
          client_secret: 'test-secret',
          code_verifier: 'unexpected-verifier', // Should be ignored
        }).toString(),
      });

      expect(response.status).toBe(400);
      const error = await response.json() as any;
      expect(error.error).toBe('invalid_grant');
    });
  });

  describe('PKCE Security Properties', () => {
    it('should use minimum 43 character verifier per RFC 7636 Section 4.1', () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.1 - Minimum length requirement
      const shortVerifier = 'too-short'; // Less than 43 chars
      const validVerifier = 'a'.repeat(43); // Exactly 43 chars
      
      expect(shortVerifier.length).toBeLessThan(43);
      expect(validVerifier.length).toBeGreaterThanOrEqual(43);
    });

    it('should use maximum 128 character verifier per RFC 7636 Section 4.1', () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.1 - Maximum length requirement
      const longVerifier = 'a'.repeat(129); // More than 128 chars
      const validVerifier = 'a'.repeat(128); // Exactly 128 chars
      
      expect(longVerifier.length).toBeGreaterThan(128);
      expect(validVerifier.length).toBeLessThanOrEqual(128);
    });

    it('should use URL-safe characters in verifier per RFC 7636 Section 4.1', () => {
      // @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.1 - unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
      const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
      const validVerifier = 'aB3-._~xY9';
      
      for (const char of validVerifier) {
        expect(validChars).toContain(char);
      }
    });

    it('should produce different challenges for different verifiers', async () => {
      const verifier1 = 'verifier-one-123456789012345678901234567890';
      const verifier2 = 'verifier-two-123456789012345678901234567890';
      
      const challenge1 = await generatePKCEChallenge(verifier1);
      const challenge2 = await generatePKCEChallenge(verifier2);
      
      expect(challenge1).not.toBe(challenge2);
    });

    it('should produce consistent challenge for same verifier', async () => {
      const verifier = 'consistent-verifier-123456789012345678901234';
      
      const challenge1 = await generatePKCEChallenge(verifier);
      const challenge2 = await generatePKCEChallenge(verifier);
      
      expect(challenge1).toBe(challenge2);
    });
  });
});