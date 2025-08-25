# @sentry/hono-oauth-provider

Simple, secure OAuth 2.1 authorization server for Hono. Works with Cloudflare Workers, Node.js, or any Hono-compatible runtime.

## Quick Start (5 minutes)

### 1. Install

```bash
npm install @sentry/hono-oauth-provider
```

### 2. Create OAuth Server

```typescript
import { Hono } from 'hono';
import { OAuthProvider } from '@sentry/hono-oauth-provider';

const app = new Hono();

// Create OAuth provider with any storage backend
const provider = new OAuthProvider({
  storage: myStorage,  // See "Storage Adapters" below
  issuer: 'https://your-domain.com',
  scopesSupported: ['read', 'write'],
});

// Mount OAuth endpoints at /oauth/*
app.route('/oauth', provider.getApp());

export default app;
```

That's it! You now have a working OAuth 2.1 server with endpoints:
- `GET/POST /oauth/authorize` - User consent
- `POST /oauth/token` - Token exchange  
- `POST /oauth/register` - Client registration
- `GET /.well-known/oauth-authorization-server` - Discovery

## Storage Adapters

The provider works with any storage that implements this simple interface:

```typescript
interface Storage {
  get(key: string): Promise<string | null>;
  get<T>(key: string, options: { type: 'json' }): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>;
}
```

### For Testing (In-Memory)

Best for development and testing - data is lost when the process restarts:

```typescript
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
  
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    // Note: TTL not implemented in this simple example
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

// Use in tests
const provider = new OAuthProvider({
  storage: new MemoryStorage(),
  issuer: 'http://localhost:8787',
  scopesSupported: ['read', 'write'],
});
```

### For Cloudflare Workers (KV)

Production-ready storage using Cloudflare KV:

```typescript
class KVStorage {
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

// Use in your Worker
export default {
  async fetch(request: Request, env: Env) {
    const app = new Hono();
    
    const provider = new OAuthProvider({
      storage: new KVStorage(env.OAUTH_KV),
      issuer: new URL(request.url).origin,
      scopesSupported: ['read', 'write'],
    });
    
    app.route('/oauth', provider.getApp());
    return app.fetch(request);
  }
};
```

Cloudflare KV setup:
```toml
# wrangler.toml
name = "my-oauth-server"
kv_namespaces = [
  { binding = "OAUTH_KV", id = "your-kv-namespace-id" }
]
```

## Pre-Register a Client (Required)

Before using OAuth, register at least one client:

```typescript
// Direct storage (recommended for setup)
await storage.put('client:my-app', JSON.stringify({
  id: 'my-app',
  secret: 'my-secret-key',  // Omit for public clients (SPAs)
  name: 'My Application',
  redirectUris: [
    'https://myapp.com/callback',
    'http://localhost:3000/callback',  // Dev URLs allowed when registered
  ]
}));
```

## Client Implementation

### 1. Get Authorization Code

```javascript
// Build authorization URL
const params = new URLSearchParams({
  response_type: 'code',
  client_id: 'my-app',
  redirect_uri: 'https://myapp.com/callback',
  scope: 'read write',
  state: crypto.randomUUID(), // CSRF protection
});

// Redirect user
window.location = `https://your-domain.com/oauth/authorize?${params}`;
```

### 2. Exchange Code for Tokens

```javascript
// After user approves and returns to your callback URL
const code = new URLSearchParams(window.location.search).get('code');

const response = await fetch('https://your-domain.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: 'https://myapp.com/callback',
    client_id: 'my-app',
    client_secret: 'my-secret-key', // Only for confidential clients
  })
});

const { access_token, refresh_token } = await response.json();
```

### 3. Use Access Token

```javascript
// Make authenticated requests
const response = await fetch('https://api.example.com/user', {
  headers: {
    'Authorization': `Bearer ${access_token}`
  }
});
```

## Protect Your API Routes

```typescript
import { OAuthProvider } from '@sentry/hono-oauth-provider';

// Create OAuth middleware
const oauth = OAuthProvider({
  storage: myStorage,
  issuer: 'https://your-domain.com',
  scopesSupported: ['read', 'write'],
});

// Add OAuth protection
app.use('*', oauth);

// Now all /api/* routes require valid Bearer tokens
app.get('/api/user', (c) => {
  const user = c.get('user'); // Automatically set by middleware
  return c.json({ userId: user.userId, scope: user.scope });
});
```

## Production Checklist

### Required Security Headers

```typescript
import { cors } from 'hono/cors';

// CORS for OAuth flow
app.use('*', cors({
  origin: ['https://myapp.com'], // Your client apps
  credentials: true,
}));

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Strict-Transport-Security', 'max-age=31536000');
});
```

### Environment Configuration

```typescript
const provider = new OAuthProvider({
  storage: new KVStorage(env.OAUTH_KV),
  issuer: env.OAUTH_ISSUER || 'https://auth.example.com',
  scopesSupported: (env.OAUTH_SCOPES || 'read,write').split(','),
  strictMode: env.NODE_ENV === 'production', // Enforce OAuth 2.1 in prod
});
```

### PKCE for Public Clients (SPAs)

Required for public clients (no client secret):

```javascript
// Generate PKCE challenge (client-side)
function base64URLEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

const verifier = base64URLEncode(crypto.getRandomValues(new Uint8Array(32)));
const encoder = new TextEncoder();
const data = encoder.encode(verifier);
const digest = await crypto.subtle.digest('SHA-256', data);
const challenge = base64URLEncode(digest);

// Include in authorization request
params.append('code_challenge', challenge);
params.append('code_challenge_method', 'S256');

// Include verifier in token exchange
tokenParams.append('code_verifier', verifier);
```

## OAuth Proxy Pattern (Store Upstream Tokens)

This provider can act as an OAuth proxy, storing upstream tokens (e.g., from Sentry, GitHub) encrypted with your downstream tokens:

```typescript
const oauth = OAuthProvider({
  storage: myStorage,
  issuer: 'https://your-api.com',
  scopesSupported: ['read', 'write'],
  
  // Refresh upstream tokens when downstream tokens are refreshed
  tokenExchangeCallback: async ({ grantType, context }) => {
    if (grantType === 'refresh_token' && context?.upstreamRefreshToken) {
      // Refresh the upstream token
      const response = await fetch('https://sentry.io/oauth/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: context.upstreamRefreshToken,
          client_id: UPSTREAM_CLIENT_ID,
          client_secret: UPSTREAM_CLIENT_SECRET,
        }),
      });
      
      const tokens = await response.json();
      return {
        // Update the stored context with new upstream tokens
        newContext: {
          upstreamToken: tokens.access_token,
          upstreamRefreshToken: tokens.refresh_token,
        },
        // Match downstream token TTL to upstream
        accessTokenTTL: tokens.expires_in,
      };
    }
  },
});

// Use upstream tokens in your API handlers
app.get('/api/proxy/*', (c) => {
  const context = c.get('oauthContext'); // Automatically decrypted
  
  if (!context?.upstreamToken) {
    return c.json({ error: 'No upstream token' }, 500);
  }
  
  // Proxy the request with upstream token
  const upstreamUrl = c.req.url.replace('your-api.com', 'sentry.io');
  return fetch(upstreamUrl, {
    headers: {
      'Authorization': `Bearer ${context.upstreamToken}`,
    },
  });
});
```

## Configuration Options

```typescript
new OAuthProvider({
  storage: Storage,           // Required: Storage adapter
  issuer: string,             // Required: Your OAuth server URL
  scopesSupported: string[],  // Required: Available scopes
  strictMode?: boolean,       // Optional: OAuth 2.1 strict mode (default: true)
  tokenExchangeCallback?: TokenExchangeCallback, // Optional: Update context during token operations
});
```

## OAuth 2.1 Features

This provider implements the latest OAuth 2.1 spec:
- ✅ No deprecated flows (implicit, password)
- ✅ PKCE required for public clients
- ✅ Exact redirect URI matching
- ✅ Short-lived auth codes (10 min)
- ✅ Refresh token rotation
- ✅ Secure token generation (256-bit)

## Testing

```typescript
import { OAuthProvider } from '@sentry/hono-oauth-provider';
import { describe, it, expect } from 'vitest';

describe('OAuth Provider', () => {
  it('should issue tokens', async () => {
    const storage = new MemoryStorage();
    
    // Register test client
    await storage.put('client:test', JSON.stringify({
      id: 'test',
      secret: 'secret',
      name: 'Test Client',
      redirectUris: ['http://localhost:3000/callback']
    }));
    
    const provider = new OAuthProvider({
      storage,
      issuer: 'http://localhost:8787',
      scopesSupported: ['read'],
    });
    
    const app = provider.getApp();
    // ... test your OAuth flow
  });
});
```

## Rate Limiting

Rate limiting is essential to prevent brute force attacks. Apply it using Hono middleware:

```typescript
// wrangler.toml
[[unsafe.bindings]]
name = "RATE_LIMITER"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 10, period = 60 }  # 10 requests per minute

// worker.ts
app.post('/oauth/token', async (c, next) => {
  const body = await c.req.parseBody();
  const { success } = await env.RATE_LIMITER.limit({ 
    key: `client:${body.client_id}` 
  });
  
  if (!success) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  
  await next();
});

// Then mount OAuth provider
app.route('/oauth', provider.getApp());
```

**Best Practices:**
- Token endpoint: Rate limit by `client_id` (10-20 req/min)
- Authorization endpoint: Rate limit by IP (5-10 req/min)  
- Return OAuth error format with 429 status

```

## Support

- [GitHub Issues](https://github.com/getsentry/sentry-mcp)
- [OAuth 2.1 Spec](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10)

## License

MIT