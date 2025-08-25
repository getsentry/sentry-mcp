/**
 * Example: Complete OAuth 2.1 Server with Hono
 * 
 * This example demonstrates all the new security features:
 * - PBKDF2 client secret hashing
 * - User consent management
 * - Maximum authorization lifetime
 * - PKCE enforcement
 * - Comprehensive error handling
 * - Modular architecture
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { 
  OAuthProvider,
  requireOAuthScope,
  ConsentManager,
  hashClientSecret,
  generateClientSecret,
  type Storage,
  type OAuth21Config 
} from './src';

// ============================================
// Storage Adapter for Testing (In-Memory)
// ============================================
class MemoryStorage implements Storage {
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

// ============================================
// Storage Adapter for Cloudflare Workers (KV)
// ============================================
class KVStorage implements Storage {
  constructor(private kv: KVNamespace) {}
  
  async get(key: string): Promise<string | null>;
  async get<T>(key: string, options: { type: 'json' }): Promise<T | null>;
  async get(key: string, options?: { type?: string }): Promise<any> {
    return options?.type === 'json' 
      ? this.kv.get(key, { type: 'json' })
      : this.kv.get(key);
  }
  
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    await this.kv.put(key, value, options);
  }
  
  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
  
  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    return this.kv.list(options);
  }
}

// ============================================
// Example 1: OAuth Server with New Security Features
// ============================================
export async function createSecureOAuthServer() {
  const app = new Hono();
  const storage = new MemoryStorage();
  
  // Pre-register clients with hashed secrets (new security feature)
  const testSecret = generateClientSecret();
  const hashedTestSecret = await hashClientSecret(testSecret);
  
  await storage.put('client:test-app', JSON.stringify({
    id: 'test-app',
    secret: hashedTestSecret, // Stored as PBKDF2 hash
    name: 'Test Application',
    redirectUris: [
      'http://localhost:3000/callback',
      'https://app.example.com/auth/callback',
    ]
  }));
  
  // Public client (no secret, requires PKCE)
  await storage.put('client:spa-app', JSON.stringify({
    id: 'spa-app',
    name: 'Single Page Application',
    redirectUris: [
      'http://localhost:3001/callback',
      'https://spa.example.com/auth',
    ]
  }));
  
  // OAuth configuration with new security settings
  const config: OAuth21Config = {
    storage,
    issuer: 'http://localhost:8787',
    scopesSupported: ['read', 'write', 'admin'],
    strictMode: true, // Enforce OAuth 2.1 (PKCE for public clients)
    maxAuthorizationLifetime: 30 * 24 * 60 * 60 * 1000, // 30 days max
  };
  
  // Create OAuth provider middleware
  const oauth = OAuthProvider(config);
  
  // Apply OAuth middleware to protect all routes
  app.use('*', oauth);
  
  // Example: Require specific scope
  app.get('/api/admin',
    requireOAuthScope('admin'),
    (c) => {
      const user = c.get('user');
      return c.json({ 
        message: 'Admin access granted',
        userId: user.userId,
        scope: user.scope
      });
    }
  );
  
  // Example: User profile endpoint
  app.get('/api/profile', (c) => {
    const user = c.get('user');
    return c.json({ 
      userId: user.userId,
      clientId: user.clientId,
      scope: user.scope,
    });
  });
  
  // Example: Consent management endpoints
  app.get('/api/consents', async (c) => {
    const user = c.get('user');
    const consentManager = new ConsentManager(storage);
    const consents = await consentManager.listUserConsents(user.userId);
    
    return c.json({ consents });
  });
  
  app.delete('/api/consents/:clientId', async (c) => {
    const user = c.get('user');
    const clientId = c.req.param('clientId');
    
    const consentManager = new ConsentManager(storage);
    await consentManager.revokeConsent(user.userId, clientId);
    
    return c.json({ success: true });
  });
  
  console.log('OAuth Server started with:');
  console.log('- Test client ID: test-app');
  console.log('- Test client secret:', testSecret);
  console.log('- Public client ID: spa-app (no secret, PKCE required)');
  
  return app;
}

// ============================================
// Example 2: Production OAuth Server for Cloudflare Workers
// ============================================
export default {
  async fetch(request: Request, env: { OAUTH_KV: KVNamespace }, ctx: ExecutionContext) {
    const app = new Hono();
    
    // CORS configuration
    app.use('*', cors({
      origin: (origin) => {
        const allowedOrigins = [
          'https://app.example.com',
          'http://localhost:3000', // Development
        ];
        return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
      },
      credentials: true,
    }));
    
    // Security headers
    app.use('*', async (c, next) => {
      await next();
      c.header('X-Frame-Options', 'DENY');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Strict-Transport-Security', 'max-age=31536000');
      c.header('X-XSS-Protection', '1; mode=block');
    });
    
    // OAuth configuration with production settings
    const config: OAuth21Config = {
      storage: new KVStorage(env.OAUTH_KV),
      issuer: new URL(request.url).origin,
      scopesSupported: ['read', 'write', 'admin', 'delete'],
      strictMode: true, // Always enforce OAuth 2.1 in production
      maxAuthorizationLifetime: 365 * 24 * 60 * 60 * 1000, // 1 year max
    };
    
    // Create and apply OAuth middleware
    const oauth = OAuthProvider(config);
    app.use('*', oauth);
    
    // Public endpoints
    app.get('/health', (c) => c.json({ 
      status: 'ok',
      features: {
        oauth21: true,
        pkce: true,
        consentManagement: true,
        tokenRotation: true,
        maxLifetime: true,
        pbkdf2: true
      }
    }));
    
    // Protected endpoints
    app.get('/api/profile', (c) => {
      const user = c.get('user');
      return c.json({ 
        userId: user.userId,
        clientId: user.clientId,
        scope: user.scope,
      });
    });
    
    app.get('/api/admin/users',
      requireOAuthScope('admin'),
      (c) => c.json({ users: [] })
    );
    
    app.delete('/api/data/:id',
      requireOAuthScope('delete'),
      (c) => c.json({ deleted: c.req.param('id') })
    );
    
    return app.fetch(request, env, ctx);
  }
};

// ============================================
// Example 3: OAuth Client with PKCE Support
// ============================================
export class SecureOAuthClient {
  private codeVerifier?: string;
  private codeChallenge?: string;
  
  constructor(
    private clientId: string,
    private clientSecret: string | null, // null for public clients
    private redirectUri: string,
    private authServerUrl: string
  ) {}
  
  // Generate PKCE challenge (required for public clients)
  private async generatePKCE() {
    // Generate code verifier
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    this.codeVerifier = btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    // Generate code challenge (S256)
    const encoder = new TextEncoder();
    const data = encoder.encode(this.codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(digest);
    
    this.codeChallenge = btoa(String.fromCharCode(...hashArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
  
  // Step 1: Get authorization URL (with PKCE for public clients)
  async getAuthorizationUrl(scope: string, state: string): Promise<string> {
    const params: Record<string, string> = {
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope,
      state,
    };
    
    // Add PKCE for public clients
    if (!this.clientSecret) {
      await this.generatePKCE();
      params.code_challenge = this.codeChallenge!;
      params.code_challenge_method = 'S256';
    }
    
    const queryString = new URLSearchParams(params).toString();
    return `${this.authServerUrl}/oauth/authorize?${queryString}`;
  }
  
  // Step 2: Exchange code for tokens (with PKCE verification)
  async exchangeCodeForTokens(code: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  }> {
    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
    };
    
    // Add client secret for confidential clients
    if (this.clientSecret) {
      params.client_secret = this.clientSecret;
    }
    
    // Add PKCE verifier for public clients
    if (this.codeVerifier) {
      params.code_verifier = this.codeVerifier;
    }
    
    const response = await fetch(`${this.authServerUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token exchange failed: ${error.error} - ${error.error_description}`);
    }
    
    return response.json();
  }
  
  // Step 3: Refresh access token (with rotation)
  async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string; // New refresh token (rotated)
    expires_in: number;
    scope: string;
  }> {
    const params: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
    };
    
    if (this.clientSecret) {
      params.client_secret = this.clientSecret;
    }
    
    const response = await fetch(`${this.authServerUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token refresh failed: ${error.error} - ${error.error_description}`);
    }
    
    return response.json();
  }
  
  // Revoke token (access or refresh)
  async revokeToken(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void> {
    const params: Record<string, string> = {
      token,
      client_id: this.clientId,
    };
    
    if (this.clientSecret) {
      params.client_secret = this.clientSecret;
    }
    
    if (tokenTypeHint) {
      params.token_type_hint = tokenTypeHint;
    }
    
    const response = await fetch(`${this.authServerUrl}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    
    if (!response.ok) {
      throw new Error(`Token revocation failed: ${response.statusText}`);
    }
  }
  
  // Introspect token to check if it's active
  async introspectToken(token: string): Promise<{
    active: boolean;
    scope?: string;
    client_id?: string;
    exp?: number;
    sub?: string;
  }> {
    const params: Record<string, string> = {
      token,
      client_id: this.clientId,
    };
    
    if (this.clientSecret) {
      params.client_secret = this.clientSecret;
    }
    
    const response = await fetch(`${this.authServerUrl}/oauth/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    
    if (!response.ok) {
      throw new Error(`Token introspection failed: ${response.statusText}`);
    }
    
    return response.json();
  }
}

// ============================================
// Example 4: Dynamic Client Registration
// ============================================
export async function registerOAuthClient(authServerUrl: string) {
  const response = await fetch(`${authServerUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'My Awesome App',
      redirect_uris: [
        'https://myapp.example.com/callback',
        'https://myapp.example.com/auth',
      ],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'read write',
      token_endpoint_auth_method: 'client_secret_post',
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Registration failed: ${error.error} - ${error.error_description}`);
  }
  
  const client = await response.json();
  console.log('Client registered successfully:');
  console.log('Client ID:', client.client_id);
  console.log('Client Secret:', client.client_secret);
  console.log('Client Name:', client.client_name);
  
  return client;
}