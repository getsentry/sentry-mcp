# OAuth Proxy Implementation Status

## Current State
Our implementation now supports OAuth **proxy** functionality with encrypted context storage for upstream tokens.

## Implemented Proxy Features

### 1. **Context Field in Data Models** ✅ COMPLETE
We have a `context` field in our Grant and Token types to store upstream tokens and other application data.

**Completed changes:**
- Added `context` field to Grant interface
- Added `encryptedContext`, `wrappedKey`, and `iv` fields for encryption
- Updated token/grant creation to handle context
- Store everything in single token key for efficiency

### 2. **API Request Proxying** ✅ PARTIAL
Context is injected into Hono middleware as `oauthContext`.

**Our approach:**
```typescript
// Context is injected into Hono context
c.set('oauthContext', decryptedContext); // Contains upstream token
// App can access via c.get('oauthContext') in route handlers
```

**What we have:**
- Context automatically decrypted and injected into Hono context
- Available as `c.get('oauthContext')` in route handlers
- App is responsible for using context to proxy requests

### 3. **Token Exchange Callback** ✅ COMPLETE
Supports refreshing upstream tokens when issuing/refreshing downstream tokens.

**Use case:**
1. User authorizes your app
2. During token exchange, YOU authorize with upstream (Sentry)
3. Store upstream token in encrypted props
4. When refreshing downstream token, also refresh upstream token

**Implemented:**
```typescript
interface TokenExchangeCallbackOptions {
  grantType: 'authorization_code' | 'refresh_token';
  clientId: string;
  userId: string;
  scope: string[];
  context: any; // Current context (contains upstream token)
}

interface TokenExchangeCallbackResult {
  newContext?: any; // Updated context (new upstream token)
  accessTokenTTL?: number; // Match upstream TTL
}
```

### 4. **Upstream Token Management** ✅ COMPLETE
Fully implemented:
- Store initial upstream token during authorization via context
- Refresh upstream token during downstream refresh via callback
- Context encrypted and stored with each token

### 5. **Context Flow Through Authorization** ✅ COMPLETE

**Authorization flow now supports:**
1. User authorizes at `/authorize`
2. App can provide context to `issueAuthorizationCode`
3. Context is encrypted and stored with grant
4. Auth code includes encrypted context
5. Client exchanges code
6. Downstream token includes encrypted context
7. Context available as `c.get('oauthContext')` in routes

## Implementation Complete! ✅

All critical OAuth proxy features have been implemented:

### ✅ Types Updated
- `context` field added to Grant and Token interfaces
- `encryptedContext`, `wrappedKey`, and `iv` fields for encryption
- Everything stored in single token key for efficiency

### ✅ Token Exchange Callback Added
- `tokenExchangeCallback` in OAuth21Config
- Supports updating context during token operations
- Can override access token TTL to match upstream

### ✅ Authorization Handler Updated
- Accepts context during authorization
- Encrypts context with auth code
- Stores encrypted context in grant

### ✅ Token Handler Updated  
- Decrypts context during code exchange
- Calls tokenExchangeCallback when configured
- Re-encrypts context with new tokens
- Single storage key per token

### ✅ Middleware Integration
- Decrypts context from bearer token
- Injects as `c.get('oauthContext')` in Hono
- App handles API proxying with context

## Example Usage

```typescript
const oauth = OAuthProvider({
  storage,
  issuer: 'https://my-proxy.com',
  scopesSupported: ['read', 'write'],
  
  // Token exchange callback to refresh upstream tokens
  tokenExchangeCallback: async ({ grantType, context }) => {
    if (grantType === 'refresh_token' && context?.upstreamRefreshToken) {
      // Refresh upstream token
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
        newContext: {
          upstreamToken: tokens.access_token,
          upstreamRefreshToken: tokens.refresh_token,
        },
        accessTokenTTL: tokens.expires_in,
      };
    }
  },
});

// Use as middleware
app.use('*', oauth);

// Access context in route handlers
app.get('/api/proxy/*', async (c) => {
  const context = c.get('oauthContext');
  if (!context?.upstreamToken) {
    return c.json({ error: 'No upstream token' }, 500);
  }
  
  // Proxy request with upstream token
  const upstreamUrl = c.req.url.replace('my-proxy.com', 'sentry.io');
  return fetch(upstreamUrl, {
    headers: {
      ...c.req.headers,
      'Authorization': `Bearer ${context.upstreamToken}`,
    },
  });
});
```

## Status Summary

### ✅ Completed Features
1. Context field in all data models
2. End-to-end encryption for context storage
3. Token exchange callback for upstream refresh
4. Authorization handler context support
5. Single storage key per token (efficient)
6. Context injection as `oauthContext` in Hono

### 🔄 Remaining Enhancements
1. **LOW**: Multi-tenant support (different upstream clients per downstream client)
2. **LOW**: Automatic context migration on token refresh
3. **LOW**: Context versioning for backward compatibility