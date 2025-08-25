# CLAUDE.md - Hono OAuth Provider

## 🎯 Package Purpose

This package wraps Cloudflare's `workers-oauth-provider` to create a Hono-compatible OAuth 2.1 Authorization Server. It is NOT an OAuth client/proxy - it's a full OAuth server that issues and manages its own tokens.

## 🔴 CRITICAL Requirements

**OAuth 2.1 Compliance Goals:**
1. **PKCE Required**: Enforce PKCE for all public clients (migration path needed)
2. **No Implicit Flow**: Never implement (already compliant ✅)
3. **No Password Grant**: Never implement (already compliant ✅)
4. **Refresh Token Rotation**: Implement one-time use refresh tokens
5. **Exact Redirect URI**: Always require exact matching (already compliant ✅)

**Security Requirements:**
1. Token entropy: Minimum 128 bits
2. Authorization codes: Single use, 10-minute expiry
3. Access tokens: Encrypted with user data
4. Refresh tokens: Rotate on each use
5. PKCE: S256 method preferred over plain

## 🟡 Architecture Overview

```
hono-oauth-provider/
├── src/
│   ├── index.ts           # Hono middleware wrapper
│   ├── oauth-provider.ts  # Cloudflare OAuth provider (upstream)
│   └── types.ts           # TypeScript definitions
└── __tests__/             # OAuth 2.1 compliance tests
```

## 📋 Implementation Status

### ✅ Completed
- PKCE support (both plain and S256)
- Authorization code flow
- Dynamic client registration
- Token refresh flow
- Discovery endpoints
- Consent management
- Token encryption (WebCrypto)

### 🚧 In Progress
- OAuth 2.1 strict mode enforcement
- Refresh token rotation
- Comprehensive compliance tests

### ❌ Not Implemented (Intentionally)
- Implicit flow (deprecated in OAuth 2.1)
- Password credentials grant (deprecated)
- Client credentials grant (not needed for our use case)

## 🔧 Key Interfaces

```typescript
// Main provider options
interface OAuthProviderOptions {
  apiHandlers: Record<string, Handler>;  // Protected endpoints
  authorizeEndpoint: string;             // Default: /oauth/authorize
  tokenEndpoint: string;                 // Default: /oauth/token
  clientRegistrationEndpoint: string;    // Default: /oauth/register
  scopesSupported: string[];             // Available scopes
}

// Token payload (encrypted in KV)
interface WorkerProps {
  id: string;           // User ID
  accessToken: string;  // Upstream API token (e.g., Sentry)
  name: string;         // User display name
  scope: string;        // Granted permissions
}
```

## 🧪 Testing Requirements

### Unit Tests
- [x] PKCE code challenge verification
- [x] Token encryption/decryption
- [x] Grant lifecycle management
- [ ] Refresh token rotation
- [ ] Error response compliance

### Integration Tests
- [ ] Full authorization flow with PKCE
- [ ] Client registration and management
- [ ] Token refresh with rotation
- [ ] Scope enforcement
- [ ] Discovery endpoint responses

### OAuth 2.1 Compliance Tests
- [ ] PKCE enforcement for public clients
- [ ] Redirect URI exact matching
- [ ] Authorization code single-use
- [ ] Token expiration handling
- [ ] Error response format (RFC 6749 Section 5.2)

## 📚 Specifications

**Primary References:**
- [OAuth 2.1 Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10)
- [PKCE RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)
- [Dynamic Client Registration RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html)
- [Token Introspection RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html)

**Implementation Guide:**
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)

## 🚀 Usage Examples

### As OAuth Provider (Server)
```typescript
import { createOAuthMiddleware } from '@sentry/hono-oauth-provider';

const app = new Hono();

// Add OAuth provider middleware
app.use('*', createOAuthMiddleware({
  apiHandlers: {
    '/api/*': protectedApiHandler,
  },
  scopesSupported: ['read', 'write'],
}));
```

### As OAuth Consumer (Client)
```typescript
// This package is NOT for OAuth clients
// Use src/server/lib/oauth.ts for consuming upstream OAuth providers
```

## ⚠️ Migration Notes

### Breaking Changes for OAuth 2.1
1. **PKCE will become mandatory** - Currently optional, will require migration
2. **Refresh tokens will rotate** - Each use invalidates previous token
3. **Stricter validation** - More comprehensive request validation

### Migration Strategy
1. Add `oauth21_strict_mode` config flag (default: false)
2. Log warnings when non-compliant requests detected
3. Provide migration period (6 months)
4. Enable strict mode by default
5. Remove legacy support

## 🔍 Common Issues

### Issue: "code_verifier is required for PKCE"
**Cause**: Authorization used PKCE but token exchange missing verifier
**Solution**: Include code_verifier in token request

### Issue: "Invalid redirect URI"
**Cause**: OAuth 2.1 requires exact URI matching
**Solution**: Ensure redirect_uri exactly matches registered value

### Issue: "Refresh token already used"
**Cause**: Attempting to reuse rotated refresh token
**Solution**: Use the new refresh token from previous response

## 📈 Performance Considerations

- **KV Operations**: Minimize reads/writes per request
- **Encryption**: Cache encryption keys in memory
- **Token Size**: Keep under 4KB for header limits
- **Cleanup**: Implement periodic expired token cleanup

## 🔐 Security Checklist

- [ ] PKCE enforced for public clients
- [ ] Authorization codes expire in 10 minutes
- [ ] Tokens use cryptographically secure random
- [ ] Refresh tokens rotate on use
- [ ] Constant-time string comparison for secrets
- [ ] Rate limiting on token endpoint
- [ ] Audit logging for security events

---
*Package maintained for OAuth 2.1 compliance and Hono integration*
*Last updated: 2024*