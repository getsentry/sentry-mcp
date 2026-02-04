# OAuth Provider Implementation

Sentry MCP acts as both an **OAuth Provider** (to MCP clients like Claude Desktop) and an **OAuth Client** (to Sentry's upstream OAuth server). This document describes the implementation.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   MCP Client    │     │   Sentry MCP    │     │  Sentry OAuth   │
│ (Claude Desktop)│     │   (Provider +   │     │   (Upstream)    │
│                 │     │     Client)     │     │                 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ 1. Authorization      │                       │
         │    Request            │                       │
         │──────────────────────>│                       │
         │                       │                       │
         │ 2. Approval Dialog    │                       │
         │<──────────────────────│                       │
         │                       │                       │
         │ 3. User Approves      │                       │
         │──────────────────────>│                       │
         │                       │                       │
         │                       │ 4. Redirect to Sentry │
         │                       │──────────────────────>│
         │                       │                       │
         │                       │ 5. User logs in       │
         │                       │<──────────────────────│
         │                       │                       │
         │                       │ 6. Callback with code │
         │                       │<──────────────────────│
         │                       │                       │
         │                       │ 7. Exchange code      │
         │                       │──────────────────────>│
         │                       │                       │
         │                       │ 8. Sentry tokens      │
         │                       │<──────────────────────│
         │                       │                       │
         │ 9. Redirect with      │                       │
         │    MCP auth code      │                       │
         │<──────────────────────│                       │
         │                       │                       │
         │ 10. Exchange code     │                       │
         │     for MCP tokens    │                       │
         │──────────────────────>│                       │
         │                       │                       │
         │ 11. MCP access token  │                       │
         │     (encrypts Sentry  │                       │
         │      tokens in props) │                       │
         │<──────────────────────│                       │
         │                       │                       │
         │ 12. API requests      │                       │
         │     with Bearer token │                       │
         │──────────────────────>│                       │
         │                       │                       │
         │                       │ 13. Use Sentry token  │
         │                       │──────────────────────>│
```

## Dual Role Design

### As OAuth Provider (RFC 6749)

Sentry MCP implements an OAuth 2.0 Authorization Server for MCP clients:

- **Authorization Endpoint**: `/oauth/authorize` - Displays approval dialog, redirects to Sentry
- **Token Endpoint**: `/oauth/token` - Issues MCP access/refresh tokens
- **Client Registration**: `/oauth/register` - Dynamic client registration (RFC 7591)
- **Metadata**: `/.well-known/oauth-authorization-server` - Server metadata (RFC 8414)

### As OAuth Client

Sentry MCP is also an OAuth client to Sentry's authorization server:

- Redirects users to `https://sentry.io/oauth/authorize/` for authentication
- Exchanges Sentry authorization codes for Sentry access tokens
- Stores Sentry tokens encrypted in grant props
- Refreshes Sentry tokens when MCP tokens are refreshed

## Endpoints

### Authorization Endpoint

**`GET /oauth/authorize`** - Display approval dialog

Query parameters (RFC 6749 Section 4.1.1):
- `response_type` (REQUIRED): Must be `code`
- `client_id` (REQUIRED): The registered client identifier
- `redirect_uri` (REQUIRED): Client callback URL (must match registered URI)
- `scope` (OPTIONAL): Space-delimited scope list
- `state` (RECOMMENDED): Opaque value for CSRF protection
- `code_challenge` (RECOMMENDED): PKCE challenge (RFC 7636)
- `code_challenge_method` (OPTIONAL): `plain` or `S256` (default: `plain`)
- `resource` (OPTIONAL): Resource indicator (RFC 8707)

**`POST /oauth/authorize`** - Process user approval

Form parameters:
- `state`: Signed state from the approval form
- `skill[]`: Selected skills to grant

### Token Endpoint

**`POST /oauth/token`** - Exchange codes/tokens

Supports two grant types (RFC 6749 Section 4.1.3, Section 6):

#### Authorization Code Grant

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={authorization_code}
&redirect_uri={redirect_uri}
&client_id={client_id}
&code_verifier={code_verifier}  # If PKCE was used
```

#### Refresh Token Grant

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={refresh_token}
&client_id={client_id}
```

#### Response

```json
{
  "access_token": "userId:grantId:secret",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "userId:grantId:secret",
  "scope": "org:read project:read"
}
```

### Client Registration Endpoint

**`POST /oauth/register`** - Register a new client (RFC 7591)

```json
{
  "redirect_uris": ["https://client.example.com/callback"],
  "client_name": "My MCP Client",
  "token_endpoint_auth_method": "none"
}
```

Response:
```json
{
  "client_id": "abc123...",
  "client_secret": "xyz789...",
  "redirect_uris": ["https://client.example.com/callback"],
  "client_name": "My MCP Client",
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}
```

### Metadata Endpoint

**`GET /.well-known/oauth-authorization-server`** - Server metadata (RFC 8414)

```json
{
  "issuer": "https://mcp.sentry.dev",
  "authorization_endpoint": "https://mcp.sentry.dev/oauth/authorize",
  "token_endpoint": "https://mcp.sentry.dev/oauth/token",
  "registration_endpoint": "https://mcp.sentry.dev/oauth/register",
  "scopes_supported": ["org:read", "project:read", "..."],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post"],
  "code_challenge_methods_supported": ["plain", "S256"]
}
```

## Token Format

Tokens follow the format: `{userId}:{grantId}:{secret}`

- **userId**: The Sentry user ID (from upstream OAuth)
- **grantId**: Unique identifier for this authorization grant
- **secret**: Random secret (32 chars for auth codes, 48 chars for tokens)

This format allows:
1. Extracting user/grant IDs without a database lookup
2. Verifying the secret against stored hash
3. Looking up the grant to decrypt props

## Storage Schema

All data stored in Cloudflare KV (`OAUTH_KV` namespace):

### Clients

Key: `client:{clientId}`
```json
{
  "clientId": "abc123",
  "clientSecret": "hashed_secret",
  "redirectUris": ["https://..."],
  "clientName": "My App",
  "tokenEndpointAuthMethod": "none",
  "grantTypes": ["authorization_code", "refresh_token"],
  "responseTypes": ["code"],
  "registrationDate": 1234567890
}
```

### Grants

Key: `grant:{userId}:{grantId}`
```json
{
  "id": "grantId",
  "clientId": "abc123",
  "userId": "user123",
  "scope": ["org:read"],
  "metadata": { "label": "User Name" },
  "encryptedProps": "base64...",
  "createdAt": 1234567890,

  "authCodeId": "hashed_code",
  "authCodeWrappedKey": "base64...",
  "codeChallenge": "challenge",
  "codeChallengeMethod": "S256",
  "resource": "https://mcp.sentry.dev/mcp"
}
```

### Tokens

Key: `token:{userId}:{grantId}:{tokenId}`
```json
{
  "id": "tokenId",
  "grantId": "grantId",
  "userId": "user123",
  "createdAt": 1234567890,
  "expiresAt": 1234571490,
  "audience": "https://mcp.sentry.dev/mcp",
  "wrappedEncryptionKey": "base64...",
  "grant": {
    "clientId": "abc123",
    "scope": ["org:read"],
    "encryptedProps": "base64..."
  }
}
```

## Security Considerations

### Props Encryption

Sentry access/refresh tokens are stored encrypted in grant props:

1. Generate a random AES-256-GCM key for each grant
2. Encrypt props JSON with the key
3. Wrap the encryption key with the authorization code (for code exchange)
4. Wrap the encryption key with the access token (for API requests)

This ensures tokens can only be decrypted by someone who has the valid auth code or access token.

### PKCE (RFC 7636)

PKCE is supported to protect against authorization code interception:

1. Client generates `code_verifier` (43-128 chars)
2. Client sends `code_challenge = BASE64URL(SHA256(code_verifier))` in auth request
3. Server stores challenge with grant
4. Client sends `code_verifier` in token request
5. Server verifies `SHA256(code_verifier) == stored_challenge`

### Resource Indicators (RFC 8707)

The `resource` parameter restricts token audience:

1. Must match the request hostname
2. Path must start with `/mcp`
3. No fragments allowed
4. Stored with grant and validated on token use

### Refresh Token Rotation

On refresh:
1. Issue new access token and refresh token
2. Store previous refresh token ID for grace period (60 seconds)
3. Accept previous refresh token during grace period
4. Reject refresh tokens older than grace period

### Upstream Token Refresh

When MCP tokens are refreshed:
1. Check if Sentry access token is expired or near expiry
2. If expired, use Sentry refresh token to get new Sentry tokens
3. Update encrypted props with new Sentry tokens
4. Return new MCP tokens with updated props

## File Structure

```
oauth/
├── index.ts              # Route definitions
├── types.ts              # TypeScript types with spec references
├── crypto.ts             # Encryption, hashing, key wrapping
├── storage.ts            # KV operations + InMemoryStorage for tests
├── helpers.ts            # parseAuthRequest, completeAuthorization, etc.
├── state.ts              # Signed state encoding/decoding
├── routes/
│   ├── authorize.ts      # GET/POST /oauth/authorize
│   ├── callback.ts       # GET /oauth/callback (Sentry callback)
│   ├── token.ts          # POST /oauth/token
│   ├── register.ts       # POST /oauth/register
│   └── metadata.ts       # GET /.well-known/oauth-authorization-server
└── middleware/
    └── auth.ts           # Bearer token validation for /mcp/*
```

## References

- [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) - OAuth 2.0 Authorization Framework
- [RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750) - Bearer Token Usage
- [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) - Dynamic Client Registration
- [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) - PKCE
- [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) - Authorization Server Metadata
- [RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707) - Resource Indicators
