/**
 * Mock OAuth 2.0 Provider for Testing
 * 
 * This implements a minimal OAuth 2.0 authorization server that mimics
 * upstream providers like GitHub, Google, etc. for testing our OAuth client
 * and OAuth 2.1 server implementation.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Context } from 'hono';

interface MockUser {
  id: string;
  email: string;
  name: string;
  apiToken: string; // Simulates Sentry API token or similar
}

interface MockClient {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  name: string;
}

interface AuthorizationCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  expires_at: number;
  code_challenge?: string;
  code_challenge_method?: string;
}

interface AccessToken {
  token: string;
  user_id: string;
  client_id: string;
  scope: string;
  expires_at: number;
}

interface RefreshToken {
  token: string;
  user_id: string;
  client_id: string;
  scope: string;
  access_token: string;
}

/**
 * Mock OAuth 2.0 Provider Implementation
 * Simulates an upstream OAuth provider (like Sentry's actual OAuth)
 */
export class MockOAuth20Provider {
  private users = new Map<string, MockUser>();
  private clients = new Map<string, MockClient>();
  private authCodes = new Map<string, AuthorizationCode>();
  private accessTokens = new Map<string, AccessToken>();
  private refreshTokens = new Map<string, RefreshToken>();
  private app: Hono;

  constructor() {
    // Initialize with test data
    this.setupTestData();
    
    // Create Hono app for the mock provider
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupTestData() {
    // Add test users
    this.users.set('user-1', {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      apiToken: 'sntrys_test_token_123', // Mock Sentry API token
    });

    this.users.set('user-2', {
      id: 'user-2',
      email: 'another@example.com', 
      name: 'Another User',
      apiToken: 'sntrys_another_token_456',
    });

    // Add test OAuth clients
    this.clients.set('test-client', {
      client_id: 'test-client',
      client_secret: 'test-secret',
      redirect_uris: ['http://localhost:3000/callback', 'http://localhost:8787/oauth/callback'],
      name: 'Test OAuth Client',
    });

    this.clients.set('public-client', {
      client_id: 'public-client',
      client_secret: '', // Public client has no secret
      redirect_uris: ['http://localhost:3000/callback'],
      name: 'Public Test Client',
    });
  }

  private setupRoutes() {
    // Enable CORS for testing
    this.app.use('*', cors());

    // OAuth 2.0 Authorization Endpoint
    this.app.get('/oauth/authorize', (c) => this.handleAuthorize(c));
    this.app.post('/oauth/authorize', (c) => this.handleAuthorizeSubmit(c));

    // OAuth 2.0 Token Endpoint
    this.app.post('/oauth/token', (c) => this.handleToken(c));

    // User Info Endpoint (mimics Sentry's /api/0/users/me/)
    this.app.get('/api/0/users/me/', (c) => this.handleUserInfo(c));

    // Discovery endpoints
    this.app.get('/.well-known/oauth-authorization-server', (c) => this.handleDiscovery(c));

    // Test helper endpoints
    this.app.post('/test/add-user', (c) => this.addTestUser(c));
    this.app.post('/test/add-client', (c) => this.addTestClient(c));
    this.app.get('/test/state', (c) => this.getTestState(c));
  }

  private async handleAuthorize(c: Context) {
    const { searchParams } = new URL(c.req.url);
    
    const response_type = searchParams.get('response_type');
    const client_id = searchParams.get('client_id');
    const redirect_uri = searchParams.get('redirect_uri');
    const scope = searchParams.get('scope') || '';
    const state = searchParams.get('state');
    const code_challenge = searchParams.get('code_challenge');
    const code_challenge_method = searchParams.get('code_challenge_method');

    // Validate request
    if (response_type !== 'code') {
      return c.json({ error: 'unsupported_response_type' }, 400);
    }

    const client = this.clients.get(client_id || '');
    if (!client) {
      return c.json({ error: 'invalid_client' }, 400);
    }

    if (redirect_uri && !client.redirect_uris.includes(redirect_uri)) {
      return c.json({ error: 'invalid_redirect_uri' }, 400);
    }

    // Return a simple consent form (in real world, would be HTML)
    return c.html(`
      <form method="POST" action="/oauth/authorize">
        <h2>Authorize ${client.name}</h2>
        <p>This app wants to access your account with scope: ${scope}</p>
        <input type="hidden" name="client_id" value="${client_id}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="scope" value="${scope}">
        <input type="hidden" name="state" value="${state || ''}">
        <input type="hidden" name="code_challenge" value="${code_challenge || ''}">
        <input type="hidden" name="code_challenge_method" value="${code_challenge_method || ''}">
        <select name="user_id">
          <option value="user-1">Test User</option>
          <option value="user-2">Another User</option>
        </select>
        <button type="submit" name="action" value="approve">Approve</button>
        <button type="submit" name="action" value="deny">Deny</button>
      </form>
    `);
  }

  private async handleAuthorizeSubmit(c: Context) {
    const formData = await c.req.formData();
    
    const action = formData.get('action');
    const client_id = formData.get('client_id') as string;
    const redirect_uri = formData.get('redirect_uri') as string;
    const scope = formData.get('scope') as string;
    const state = formData.get('state') as string;
    const user_id = formData.get('user_id') as string;
    const code_challenge = formData.get('code_challenge') as string;
    const code_challenge_method = formData.get('code_challenge_method') as string;

    const redirectUrl = new URL(redirect_uri);

    if (action === 'deny') {
      redirectUrl.searchParams.set('error', 'access_denied');
      if (state) redirectUrl.searchParams.set('state', state);
      return c.redirect(redirectUrl.toString());
    }

    // Generate authorization code
    const code = this.generateCode();
    
    this.authCodes.set(code, {
      code,
      client_id,
      user_id,
      redirect_uri,
      scope,
      expires_at: Date.now() + 600000, // 10 minutes
      code_challenge,
      code_challenge_method: code_challenge_method || 'plain',
    });

    // Redirect with code
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);
    
    return c.redirect(redirectUrl.toString());
  }

  private async handleToken(c: Context) {
    const body = await c.req.parseBody();
    
    const grant_type = body.grant_type as string;
    const client_id = body.client_id as string;
    const client_secret = body.client_secret as string;

    // Validate client
    const client = this.clients.get(client_id);
    if (!client) {
      return c.json({ error: 'invalid_client' }, 401);
    }

    // Check client authentication (if confidential client)
    if (client.client_secret && client.client_secret !== client_secret) {
      return c.json({ error: 'invalid_client' }, 401);
    }

    if (grant_type === 'authorization_code') {
      return this.handleAuthorizationCodeGrant(c, body, client);
    } else if (grant_type === 'refresh_token') {
      return this.handleRefreshTokenGrant(c, body, client);
    } else {
      return c.json({ error: 'unsupported_grant_type' }, 400);
    }
  }

  private async handleAuthorizationCodeGrant(c: Context, body: any, client: MockClient) {
    const code = body.code as string;
    const redirect_uri = body.redirect_uri as string;
    const code_verifier = body.code_verifier as string;

    const authCode = this.authCodes.get(code);
    if (!authCode) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid authorization code' }, 400);
    }

    // Check expiration
    if (Date.now() > authCode.expires_at) {
      this.authCodes.delete(code);
      return c.json({ error: 'invalid_grant', error_description: 'Authorization code expired' }, 400);
    }

    // Verify client
    if (authCode.client_id !== client.client_id) {
      return c.json({ error: 'invalid_grant', error_description: 'Code was issued to different client' }, 400);
    }

    // Verify redirect_uri
    if (redirect_uri && redirect_uri !== authCode.redirect_uri) {
      return c.json({ error: 'invalid_grant', error_description: 'Redirect URI mismatch' }, 400);
    }

    // Verify PKCE if used
    if (authCode.code_challenge) {
      if (!code_verifier) {
        return c.json({ error: 'invalid_request', error_description: 'Code verifier required' }, 400);
      }

      let expectedChallenge = code_verifier;
      if (authCode.code_challenge_method === 'S256') {
        // Calculate SHA256 of verifier
        const encoder = new TextEncoder();
        const data = encoder.encode(code_verifier);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        expectedChallenge = btoa(String.fromCharCode(...hashArray))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');
      }

      if (expectedChallenge !== authCode.code_challenge) {
        return c.json({ error: 'invalid_grant', error_description: 'Invalid code verifier' }, 400);
      }
    }

    // Delete used code (single use)
    this.authCodes.delete(code);

    // Generate tokens
    const user = this.users.get(authCode.user_id)!;
    const accessToken = this.generateToken();
    const refreshToken = this.generateToken();

    // Store tokens
    this.accessTokens.set(accessToken, {
      token: accessToken,
      user_id: authCode.user_id,
      client_id: authCode.client_id,
      scope: authCode.scope,
      expires_at: Date.now() + 3600000, // 1 hour
    });

    this.refreshTokens.set(refreshToken, {
      token: refreshToken,
      user_id: authCode.user_id,
      client_id: authCode.client_id,
      scope: authCode.scope,
      access_token: accessToken,
    });

    // Return OAuth 2.0 token response
    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: authCode.scope,
      // Additional fields that upstream providers might include
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
  }

  private async handleRefreshTokenGrant(c: Context, body: any, client: MockClient) {
    const refresh_token = body.refresh_token as string;

    const refreshData = this.refreshTokens.get(refresh_token);
    if (!refreshData) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400);
    }

    // Verify client
    if (refreshData.client_id !== client.client_id) {
      return c.json({ error: 'invalid_grant', error_description: 'Token was issued to different client' }, 400);
    }

    // OAuth 2.0 allows refresh token reuse (OAuth 2.1 would rotate)
    const user = this.users.get(refreshData.user_id)!;
    const newAccessToken = this.generateToken();

    // Store new access token
    this.accessTokens.set(newAccessToken, {
      token: newAccessToken,
      user_id: refreshData.user_id,
      client_id: refreshData.client_id,
      scope: refreshData.scope,
      expires_at: Date.now() + 3600000,
    });

    // Update refresh token's access token reference
    refreshData.access_token = newAccessToken;

    return c.json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh_token, // Same refresh token (OAuth 2.0 behavior)
      scope: refreshData.scope,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
  }

  private async handleUserInfo(c: Context) {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const token = auth.substring(7);
    const tokenData = this.accessTokens.get(token);
    
    if (!tokenData) {
      return c.json({ error: 'invalid_token' }, 401);
    }

    if (Date.now() > tokenData.expires_at) {
      return c.json({ error: 'token_expired' }, 401);
    }

    const user = this.users.get(tokenData.user_id);
    if (!user) {
      return c.json({ error: 'user_not_found' }, 404);
    }

    // Return user info (mimics Sentry API response)
    return c.json({
      id: user.id,
      email: user.email,
      name: user.name,
      // Include the API token that our OAuth 2.1 server would store
      apiToken: user.apiToken,
    });
  }

  private async handleDiscovery(c: Context) {
    const baseUrl = new URL(c.req.url).origin;
    
    return c.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      userinfo_endpoint: `${baseUrl}/api/0/users/me/`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['plain', 'S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      scopes_supported: ['read', 'write', 'admin'],
    });
  }

  // Test helper methods
  private async addTestUser(c: Context) {
    const user = await c.req.json<MockUser>();
    this.users.set(user.id, user);
    return c.json({ success: true });
  }

  private async addTestClient(c: Context) {
    const client = await c.req.json<MockClient>();
    this.clients.set(client.client_id, client);
    return c.json({ success: true });
  }

  private async getTestState(c: Context) {
    return c.json({
      users: Array.from(this.users.values()),
      clients: Array.from(this.clients.values()),
      authCodes: Array.from(this.authCodes.values()),
      accessTokens: Array.from(this.accessTokens.values()),
      refreshTokens: Array.from(this.refreshTokens.values()),
    });
  }

  private generateCode(): string {
    return 'code_' + Math.random().toString(36).substring(2, 15);
  }

  private generateToken(): string {
    return 'token_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Get the Hono app for testing
   */
  getApp() {
    return this.app;
  }

  /**
   * Reset all data for testing
   */
  reset() {
    this.users.clear();
    this.clients.clear();
    this.authCodes.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();
    this.setupTestData();
  }
}

/**
 * Create a mock OAuth 2.0 provider instance for testing
 */
export function createMockOAuth20Provider() {
  return new MockOAuth20Provider();
}