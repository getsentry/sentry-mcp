/**
 * MSW Handlers for Mock OAuth 2.0 Provider
 * 
 * Provides realistic OAuth 2.0 server responses for testing
 * OAuth client implementations and OAuth 2.1 server compliance.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// In-memory stores for OAuth state
const authorizationCodes = new Map<string, {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  expiresAt: number;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}>();

const accessTokens = new Map<string, {
  userId: string;
  clientId: string;
  scope: string;
  expiresAt: number;
}>();

const refreshTokens = new Map<string, {
  userId: string;
  clientId: string;
  scope: string;
  accessToken: string;
}>();

const oauthClients = new Map<string, {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  name: string;
}>();

// Test users
const testUsers = new Map([
  ['user-1', {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    apiToken: 'sntrys_test_token_123',
  }],
  ['user-2', {
    id: 'user-2',
    email: 'another@example.com',
    name: 'Another User',
    apiToken: 'sntrys_another_token_456',
  }],
]);

// Test OAuth clients
oauthClients.set('test-client', {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  redirectUris: ['http://localhost:3000/callback', 'http://localhost:8787/oauth/callback'],
  name: 'Test OAuth Client',
});

oauthClients.set('public-client', {
  clientId: 'public-client',
  clientSecret: '', // Public client
  redirectUris: ['http://localhost:3000/callback'],
  name: 'Public Test Client',
});

/**
 * Generate random code/token
 */
function generateToken(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * OAuth 2.0 Mock Handlers
 */
export const oauth20Handlers = [
  // Authorization endpoint (GET) - Show consent screen
  http.get('*/oauth/authorize', ({ request }) => {
    const url = new URL(request.url);
    const responseType = url.searchParams.get('response_type');
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const scope = url.searchParams.get('scope') || '';
    const state = url.searchParams.get('state');
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method');

    // Validate request
    if (responseType !== 'code') {
      return HttpResponse.json({ 
        error: 'unsupported_response_type',
        error_description: 'Only authorization code flow is supported'
      }, { status: 400 });
    }

    const client = oauthClients.get(clientId || '');
    if (!client) {
      return HttpResponse.json({ 
        error: 'invalid_client',
        error_description: 'Client not found'
      }, { status: 400 });
    }

    if (redirectUri && !client.redirectUris.includes(redirectUri)) {
      return HttpResponse.json({ 
        error: 'invalid_redirect_uri',
        error_description: 'Redirect URI not registered'
      }, { status: 400 });
    }

    // Return HTML consent form
    return new HttpResponse(
      `<!DOCTYPE html>
      <html>
      <head><title>OAuth Consent</title></head>
      <body>
        <h2>Authorize ${client.name}</h2>
        <p>This app wants to access your account with scope: ${scope}</p>
        <form method="POST" action="/oauth/authorize">
          <input type="hidden" name="client_id" value="${clientId}">
          <input type="hidden" name="redirect_uri" value="${redirectUri}">
          <input type="hidden" name="scope" value="${scope}">
          <input type="hidden" name="state" value="${state || ''}">
          <input type="hidden" name="code_challenge" value="${codeChallenge || ''}">
          <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod || ''}">
          <select name="user_id">
            <option value="user-1">Test User</option>
            <option value="user-2">Another User</option>
          </select>
          <button type="submit" name="action" value="approve">Approve</button>
          <button type="submit" name="action" value="deny">Deny</button>
        </form>
      </body>
      </html>`,
      { 
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }),

  // Authorization endpoint (POST) - Process consent
  http.post('*/oauth/authorize', async ({ request }) => {
    const formData = await request.formData();
    const action = formData.get('action');
    const clientId = formData.get('client_id') as string;
    const redirectUri = formData.get('redirect_uri') as string;
    const scope = formData.get('scope') as string;
    const state = formData.get('state') as string;
    const userId = formData.get('user_id') as string;
    const codeChallenge = formData.get('code_challenge') as string;
    const codeChallengeMethod = formData.get('code_challenge_method') as string;

    const redirectUrl = new URL(redirectUri);

    if (action === 'deny') {
      redirectUrl.searchParams.set('error', 'access_denied');
      if (state) redirectUrl.searchParams.set('state', state);
      return new HttpResponse(null, {
        status: 302,
        headers: { 'Location': redirectUrl.toString() }
      });
    }

    // Generate authorization code
    const code = generateToken('code');
    
    authorizationCodes.set(code, {
      clientId,
      userId,
      redirectUri,
      scope,
      expiresAt: Date.now() + 600000, // 10 minutes
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod || 'plain',
    });

    // Redirect with code
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);
    
    return new HttpResponse(null, {
      status: 302,
      headers: { 'Location': redirectUrl.toString() }
    });
  }),

  // Token endpoint
  http.post('*/oauth/token', async ({ request }) => {
    const body = await request.formData();
    const grantType = body.get('grant_type') as string;
    const clientId = body.get('client_id') as string;
    const clientSecret = body.get('client_secret') as string;

    // Validate client
    const client = oauthClients.get(clientId);
    if (!client) {
      return HttpResponse.json({ 
        error: 'invalid_client',
        error_description: 'Client not found'
      }, { status: 401 });
    }

    // Check client authentication (if confidential)
    if (client.clientSecret && client.clientSecret !== clientSecret) {
      return HttpResponse.json({ 
        error: 'invalid_client',
        error_description: 'Invalid client credentials'
      }, { status: 401 });
    }

    if (grantType === 'authorization_code') {
      const code = body.get('code') as string;
      const redirectUri = body.get('redirect_uri') as string;
      const codeVerifier = body.get('code_verifier') as string;

      const authCode = authorizationCodes.get(code);
      if (!authCode) {
        return HttpResponse.json({ 
          error: 'invalid_grant',
          error_description: 'Invalid authorization code'
        }, { status: 400 });
      }

      // Check expiration
      if (Date.now() > authCode.expiresAt) {
        authorizationCodes.delete(code);
        return HttpResponse.json({ 
          error: 'invalid_grant',
          error_description: 'Authorization code expired'
        }, { status: 400 });
      }

      // Verify client
      if (authCode.clientId !== clientId) {
        return HttpResponse.json({ 
          error: 'invalid_grant',
          error_description: 'Code was issued to different client'
        }, { status: 400 });
      }

      // Verify redirect_uri
      if (redirectUri && redirectUri !== authCode.redirectUri) {
        return HttpResponse.json({ 
          error: 'invalid_grant',
          error_description: 'Redirect URI mismatch'
        }, { status: 400 });
      }

      // Verify PKCE if used
      if (authCode.codeChallenge) {
        if (!codeVerifier) {
          return HttpResponse.json({ 
            error: 'invalid_request',
            error_description: 'Code verifier required for PKCE'
          }, { status: 400 });
        }

        let expectedChallenge = codeVerifier;
        if (authCode.codeChallengeMethod === 'S256') {
          // Calculate SHA256
          const encoder = new TextEncoder();
          const data = encoder.encode(codeVerifier);
          const hashBuffer = await crypto.subtle.digest('SHA-256', data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          expectedChallenge = btoa(String.fromCharCode(...hashArray))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        }

        if (expectedChallenge !== authCode.codeChallenge) {
          return HttpResponse.json({ 
            error: 'invalid_grant',
            error_description: 'Invalid PKCE code verifier'
          }, { status: 400 });
        }
      }

      // Delete used code (single use)
      authorizationCodes.delete(code);

      // Generate tokens
      const user = testUsers.get(authCode.userId)!;
      const accessToken = generateToken('access');
      const refreshToken = generateToken('refresh');

      // Store tokens
      accessTokens.set(accessToken, {
        userId: authCode.userId,
        clientId: authCode.clientId,
        scope: authCode.scope,
        expiresAt: Date.now() + 3600000, // 1 hour
      });

      refreshTokens.set(refreshToken, {
        userId: authCode.userId,
        clientId: authCode.clientId,
        scope: authCode.scope,
        accessToken,
      });

      // Return OAuth 2.0 response
      return HttpResponse.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: authCode.scope,
        // Additional fields
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = body.get('refresh_token') as string;
      const refreshData = refreshTokens.get(refreshToken);
      
      if (!refreshData) {
        return HttpResponse.json({ 
          error: 'invalid_grant',
          error_description: 'Invalid refresh token'
        }, { status: 400 });
      }

      if (refreshData.clientId !== clientId) {
        return HttpResponse.json({ 
          error: 'invalid_grant',
          error_description: 'Token was issued to different client'
        }, { status: 400 });
      }

      // OAuth 2.0: reuse refresh token (OAuth 2.1 would rotate)
      const user = testUsers.get(refreshData.userId)!;
      const newAccessToken = generateToken('access');

      accessTokens.set(newAccessToken, {
        userId: refreshData.userId,
        clientId: refreshData.clientId,
        scope: refreshData.scope,
        expiresAt: Date.now() + 3600000,
      });

      return HttpResponse.json({
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshToken, // Same token (OAuth 2.0)
        scope: refreshData.scope,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    }

    return HttpResponse.json({ 
      error: 'unsupported_grant_type',
      error_description: `Grant type '${grantType}' is not supported`
    }, { status: 400 });
  }),

  // User info endpoint
  http.get('*/api/0/users/me/', ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return HttpResponse.json({ 
        error: 'unauthorized',
        detail: 'Authentication required'
      }, { status: 401 });
    }

    const token = auth.substring(7);
    const tokenData = accessTokens.get(token);
    
    if (!tokenData) {
      return HttpResponse.json({ 
        error: 'invalid_token',
        detail: 'Invalid or expired token'
      }, { status: 401 });
    }

    if (Date.now() > tokenData.expiresAt) {
      return HttpResponse.json({ 
        error: 'token_expired',
        detail: 'Access token has expired'
      }, { status: 401 });
    }

    const user = testUsers.get(tokenData.userId);
    if (!user) {
      return HttpResponse.json({ 
        error: 'user_not_found',
        detail: 'User not found'
      }, { status: 404 });
    }

    return HttpResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      apiToken: user.apiToken,
    });
  }),

  // Discovery endpoint
  http.get('*/.well-known/oauth-authorization-server', ({ request }) => {
    const baseUrl = new URL(request.url).origin;
    
    return HttpResponse.json({
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
  }),
];

/**
 * Setup mock OAuth 2.0 server
 */
export function setupMockOAuth20Server() {
  return setupServer(...oauth20Handlers);
}

/**
 * Reset OAuth state (for testing)
 */
export function resetOAuthState() {
  authorizationCodes.clear();
  accessTokens.clear();
  refreshTokens.clear();
  
  // Reset to default clients
  oauthClients.clear();
  oauthClients.set('test-client', {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUris: ['http://localhost:3000/callback', 'http://localhost:8787/oauth/callback'],
    name: 'Test OAuth Client',
  });
  oauthClients.set('public-client', {
    clientId: 'public-client',
    clientSecret: '',
    redirectUris: ['http://localhost:3000/callback'],
    name: 'Public Test Client',
  });
}

/**
 * Add test client (for testing)
 */
export function addTestClient(client: {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  name: string;
}) {
  oauthClients.set(client.clientId, client);
}

/**
 * Add test user (for testing)
 */
export function addTestUser(user: {
  id: string;
  email: string;
  name: string;
  apiToken: string;
}) {
  testUsers.set(user.id, user);
}