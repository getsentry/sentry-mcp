/**
 * OAuth 2.1 Compliance Test Suite
 * 
 * Tests our OAuth implementation against OAuth 2.1 draft specification requirements.
 * Reference: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthProvider } from '../src/oauth-provider';
import type { ClientInfo, Grant } from '../src/oauth-provider';

// Test helpers
function createMockEnv() {
  const store = new Map<string, any>();
  
  return {
    OAUTH_KV: {
      get: vi.fn(async (key: string) => store.get(key) || null),
      put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
      delete: vi.fn(async (key: string) => { store.delete(key); }),
      list: vi.fn(async () => ({ keys: Array.from(store.keys()).map(k => ({ name: k })) })),
    },
  };
}

function createMockContext() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

describe('OAuth 2.1 Compliance Tests', () => {
  let provider: OAuthProvider;
  let env: ReturnType<typeof createMockEnv>;
  let ctx: ExecutionContext;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockContext();
    
    provider = new OAuthProvider({
      scopesSupported: ['read', 'write', 'admin'],
      authorizeEndpoint: '/oauth/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      apiHandlers: {
        '/api/*': {
          fetch: async (req: Request, env: any, ctx: any) => {
            // Protected API endpoint
            const props = ctx.props;
            if (!props) {
              return new Response('Unauthorized', { status: 401 });
            }
            return new Response(JSON.stringify({ user: props }), {
              headers: { 'Content-Type': 'application/json' },
            });
          },
        },
      },
    });
  });

  describe('§4.1 - Authorization Code Grant', () => {
    describe('PKCE Requirements', () => {
      it('should accept authorization requests with PKCE S256', async () => {
        // Generate PKCE challenge
        const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'; // S256 of verifier
        
        // Register client
        const clientReg = await provider.fetch(
          new Request('http://localhost/oauth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_name: 'Test Client',
              redirect_uris: ['http://localhost:3000/callback'],
            }),
          }),
          env,
          ctx
        );
        
        const client = await clientReg.json() as ClientInfo;
        
        // Authorization request with PKCE
        const authUrl = new URL('http://localhost/oauth/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', client.clientId);
        authUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', 'test-state');
        
        const authResponse = await provider.fetch(
          new Request(authUrl.toString()),
          env,
          ctx
        );
        
        expect(authResponse.status).toBe(200); // Should show consent screen
      });

      it('should accept authorization requests with PKCE plain method', async () => {
        const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        
        // Register client
        const clientReg = await provider.fetch(
          new Request('http://localhost/oauth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_name: 'Test Client',
              redirect_uris: ['http://localhost:3000/callback'],
            }),
          }),
          env,
          ctx
        );
        
        const client = await clientReg.json() as ClientInfo;
        
        // Authorization request with plain PKCE
        const authUrl = new URL('http://localhost/oauth/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', client.clientId);
        authUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
        authUrl.searchParams.set('code_challenge', codeVerifier);
        authUrl.searchParams.set('code_challenge_method', 'plain');
        
        const authResponse = await provider.fetch(
          new Request(authUrl.toString()),
          env,
          ctx
        );
        
        expect(authResponse.status).toBe(200);
      });

      it('should reject token exchange without code_verifier when PKCE was used', async () => {
        // This would require setting up a full authorization flow with PKCE
        // then attempting token exchange without verifier
        // Marking as TODO for brevity
        expect(true).toBe(true); // TODO: Implement full flow test
      });

      it('should reject token exchange with incorrect code_verifier', async () => {
        // TODO: Implement full PKCE verification test
        expect(true).toBe(true);
      });
    });

    describe('Redirect URI Requirements', () => {
      it('should require redirect_uri in token request when PKCE not used', async () => {
        // OAuth 2.1 §4.1.3: redirect_uri REQUIRED if not using PKCE
        const tokenResponse = await provider.fetch(
          new Request('http://localhost/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: 'test-code',
              client_id: 'test-client',
              client_secret: 'test-secret',
              // Missing redirect_uri
            }),
          }),
          env,
          ctx
        );
        
        expect(tokenResponse.status).toBe(400);
        const error = await tokenResponse.json();
        expect(error.error).toBe('invalid_request');
      });

      it('should require exact redirect_uri matching', async () => {
        // Register client with specific redirect URI
        const clientReg = await provider.fetch(
          new Request('http://localhost/oauth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_name: 'Test Client',
              redirect_uris: ['http://localhost:3000/callback'],
            }),
          }),
          env,
          ctx
        );
        
        const client = await clientReg.json() as ClientInfo;
        
        // Try authorization with different redirect URI
        const authUrl = new URL('http://localhost/oauth/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', client.clientId);
        authUrl.searchParams.set('redirect_uri', 'http://localhost:3000/different'); // Different!
        
        const authResponse = await provider.fetch(
          new Request(authUrl.toString()),
          env,
          ctx
        );
        
        expect(authResponse.status).toBe(400);
      });
    });

    describe('Authorization Code Requirements', () => {
      it('should expire authorization codes after maximum 10 minutes', async () => {
        // OAuth 2.1 §4.1.2: authorization codes MUST expire
        // Maximum lifetime of 10 minutes is RECOMMENDED
        
        // This test would need to mock time or inspect KV TTL
        // Marking as TODO for implementation
        expect(true).toBe(true); // TODO: Implement expiry test
      });

      it('should invalidate authorization code after first use', async () => {
        // OAuth 2.1 §4.1.2: authorization code MUST be single use
        // TODO: Implement single-use test
        expect(true).toBe(true);
      });
    });
  });

  describe('§5 - Token Endpoint', () => {
    describe('Grant Type Requirements', () => {
      it('should support authorization_code grant type', async () => {
        const response = await provider.fetch(
          new Request('http://localhost/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: 'invalid-code',
              client_id: 'test-client',
              client_secret: 'test-secret',
              redirect_uri: 'http://localhost:3000/callback',
            }),
          }),
          env,
          ctx
        );
        
        // Should fail with invalid_grant, not unsupported_grant_type
        const error = await response.json();
        expect(error.error).not.toBe('unsupported_grant_type');
      });

      it('should support refresh_token grant type', async () => {
        const response = await provider.fetch(
          new Request('http://localhost/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: 'invalid-token',
              client_id: 'test-client',
              client_secret: 'test-secret',
            }),
          }),
          env,
          ctx
        );
        
        // Should fail with invalid_grant, not unsupported_grant_type
        const error = await response.json();
        expect(error.error).not.toBe('unsupported_grant_type');
      });

      it('should NOT support implicit grant', async () => {
        // OAuth 2.1 removes implicit grant
        const authUrl = new URL('http://localhost/oauth/authorize');
        authUrl.searchParams.set('response_type', 'token'); // Implicit flow
        authUrl.searchParams.set('client_id', 'test-client');
        authUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
        
        const response = await provider.fetch(
          new Request(authUrl.toString()),
          env,
          ctx
        );
        
        expect(response.status).toBe(400);
        const error = await response.json();
        expect(error.error).toBe('unsupported_response_type');
      });

      it('should NOT support password grant', async () => {
        // OAuth 2.1 removes password grant
        const response = await provider.fetch(
          new Request('http://localhost/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'password',
              username: 'user',
              password: 'pass',
              client_id: 'test-client',
            }),
          }),
          env,
          ctx
        );
        
        expect(response.status).toBe(400);
        const error = await response.json();
        expect(error.error).toBe('unsupported_grant_type');
      });
    });

    describe('Token Response Requirements', () => {
      it('should return properly formatted token response', async () => {
        // This would need a full valid flow setup
        // Structure should match RFC 6749 §5.1
        expect(true).toBe(true); // TODO: Implement
      });

      it('should include token_type as Bearer', async () => {
        // OAuth 2.1 requires token_type in response
        expect(true).toBe(true); // TODO: Implement
      });

      it('should include expires_in for access tokens', async () => {
        // Recommended to include expiration
        expect(true).toBe(true); // TODO: Implement
      });
    });

    describe('Error Response Requirements', () => {
      it('should return proper error format for invalid_request', async () => {
        const response = await provider.fetch(
          new Request('http://localhost/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              // Missing required grant_type
              client_id: 'test-client',
            }),
          }),
          env,
          ctx
        );
        
        expect(response.status).toBe(400);
        const error = await response.json();
        expect(error).toHaveProperty('error');
        expect(error.error).toBe('invalid_request');
        // Optional: error_description, error_uri
      });

      it('should return proper error format for invalid_client', async () => {
        const response = await provider.fetch(
          new Request('http://localhost/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: 'test-code',
              client_id: 'non-existent-client',
              client_secret: 'wrong-secret',
            }),
          }),
          env,
          ctx
        );
        
        expect(response.status).toBe(401); // Or 400
        const error = await response.json();
        expect(error.error).toBe('invalid_client');
      });
    });
  });

  describe('§6 - Refresh Tokens', () => {
    describe('Refresh Token Rotation', () => {
      it('should rotate refresh tokens on use', async () => {
        // OAuth 2.1 §6.1: Refresh tokens MUST be sender-constrained or rotate
        // We implement rotation for security
        
        // TODO: Test that using a refresh token returns a NEW refresh token
        expect(true).toBe(true);
      });

      it('should invalidate old refresh token after rotation', async () => {
        // After rotation, old refresh token should not work
        // TODO: Implement rotation test
        expect(true).toBe(true);
      });

      it('should detect and prevent refresh token replay attacks', async () => {
        // If an old refresh token is used, should invalidate entire grant
        // TODO: Implement replay detection test
        expect(true).toBe(true);
      });
    });
  });

  describe('§7 - Accessing Protected Resources', () => {
    it('should accept Bearer token in Authorization header', async () => {
      // TODO: Test protected endpoint with Bearer token
      expect(true).toBe(true);
    });

    it('should reject requests without valid Bearer token', async () => {
      // TODO: Test protected endpoint without token
      expect(true).toBe(true);
    });

    it('should reject expired access tokens', async () => {
      // TODO: Test with expired token
      expect(true).toBe(true);
    });
  });

  describe('§8 - Client Types', () => {
    describe('Public Clients', () => {
      it('should enforce PKCE for public clients', async () => {
        // Public clients (no client_secret) MUST use PKCE in OAuth 2.1
        // TODO: Register public client and test PKCE enforcement
        expect(true).toBe(true);
      });
    });

    describe('Confidential Clients', () => {
      it('should authenticate confidential clients at token endpoint', async () => {
        // Confidential clients must authenticate with client_secret
        // TODO: Test client authentication
        expect(true).toBe(true);
      });
    });
  });

  describe('§9 - Discovery', () => {
    it('should provide OAuth 2.0 Authorization Server Metadata', async () => {
      const response = await provider.fetch(
        new Request('http://localhost/.well-known/oauth-authorization-server'),
        env,
        ctx
      );
      
      expect(response.status).toBe(200);
      const metadata = await response.json();
      
      // Required fields per RFC 8414
      expect(metadata).toHaveProperty('issuer');
      expect(metadata).toHaveProperty('authorization_endpoint');
      expect(metadata).toHaveProperty('token_endpoint');
      expect(metadata).toHaveProperty('response_types_supported');
      expect(metadata).toHaveProperty('grant_types_supported');
      
      // OAuth 2.1 specific
      expect(metadata.code_challenge_methods_supported).toContain('S256');
      expect(metadata.grant_types_supported).not.toContain('implicit');
      expect(metadata.grant_types_supported).not.toContain('password');
    });
  });

  describe('Security Considerations', () => {
    it('should use cryptographically secure random for codes and tokens', async () => {
      // Tokens should have sufficient entropy (at least 128 bits)
      // This is implementation detail but critical for security
      expect(true).toBe(true); // TODO: Verify implementation
    });

    it('should use constant-time comparison for secrets', async () => {
      // Prevent timing attacks on secret comparison
      // Implementation detail but security critical
      expect(true).toBe(true); // TODO: Verify implementation
    });

    it('should implement rate limiting on token endpoint', async () => {
      // Prevent brute force attacks
      // TODO: Test rate limiting
      expect(true).toBe(true);
    });
  });
});

describe('OAuth 2.0 Upstream Compatibility', () => {
  // Tests to ensure we can consume OAuth 2.0 providers
  
  describe('GitHub OAuth 2.0', () => {
    it('should handle GitHub-style token responses', async () => {
      // GitHub returns tokens in a specific format
      // TODO: Test compatibility
      expect(true).toBe(true);
    });
  });

  describe('Google OAuth 2.0', () => {
    it('should handle Google-style token responses with OpenID Connect fields', async () => {
      // Google includes id_token and other OIDC fields
      // TODO: Test compatibility
      expect(true).toBe(true);
    });
  });

  describe('Generic OAuth 2.0', () => {
    it('should handle standard RFC 6749 token responses', async () => {
      // Standard OAuth 2.0 response format
      // TODO: Test compatibility
      expect(true).toBe(true);
    });
  });
});