# Refactor mcp-cloudflare into Multi-Worker Architecture

## Overview

Split the monolithic `mcp-cloudflare` package into 4 independent Cloudflare Workers with clear separation of concerns, using service bindings for inter-worker communication.

---

# ARCHITECTURAL SPECIFICATION

## 1. System Overview

### 1.1 Current State
The existing `mcp-cloudflare` package is a monolithic Cloudflare Worker that handles:
- Static asset serving (React SPA)
- MCP protocol handling with OAuth
- Chat API with OpenAI integration
- AutoRAG documentation search
- Two separate OAuth flows (MCP server + Chat client)

All functionality runs in a single worker, wrapped by `@cloudflare/workers-oauth-provider`.

### 1.2 Target State
Four independent Cloudflare Workers communicating via service bindings:

| Worker | Cloudflare Name | Primary Responsibility |
|--------|-----------------|----------------------|
| Router | `sentry-mcp-router` | Request routing, rate limiting, CORS |
| Web | `sentry-mcp-web` | Static assets, Chat API, Search API |
| API | `sentry-mcp-api` | MCP protocol, tools execution |
| OAuth | `sentry-mcp-oauth` | OAuth 2.1 server, token management |

### 1.3 Design Principles
1. **Single Responsibility**: Each worker does one thing well
2. **Copy-First Migration**: Copy files, verify, then prune (never move)
3. **Zero-Latency Communication**: Service bindings run on same thread
4. **Independent Deployability**: Each worker deploys separately
5. **Graceful Degradation**: Failures in one service don't cascade

---

## 2. Request Flow Architecture

### 2.1 High-Level Request Flow

```
Internet Request
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    sentry-mcp-router                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Rate Limit  │→ │ CORS Check  │→ │ Route Dispatcher    │  │
│  └─────────────┘  └─────────────┘  └──────────┬──────────┘  │
└───────────────────────────────────────────────┼──────────────┘
                                                │
        ┌───────────────────┬───────────────────┼───────────────────┐
        │                   │                   │                   │
        ▼                   ▼                   ▼                   ▼
   /api/*, /         /mcp/*, /.mcp/*      /oauth/*          /.well-known/*
        │                   │                   │                   │
        ▼                   ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ sentry-mcp-   │   │ sentry-mcp-   │   │ sentry-mcp-   │   │ sentry-mcp-   │
│     web       │   │     api       │   │    oauth      │   │    oauth      │
└───────────────┘   └───────┬───────┘   └───────────────┘   └───────────────┘
                            │
                            │ RPC: validateToken()
                            ▼
                    ┌───────────────┐
                    │ sentry-mcp-   │
                    │    oauth      │
                    └───────────────┘
```

### 2.2 Route Mapping

| Path Pattern | Target Worker | Auth Required | Rate Limit |
|-------------|---------------|---------------|------------|
| `/` (static assets) | web | No | No |
| `/api/chat` | web | Yes (cookie) | CHAT_RATE_LIMITER |
| `/api/search` | web | No | SEARCH_RATE_LIMITER |
| `/api/auth/*` | web | No | MCP_RATE_LIMITER |
| `/api/metadata` | web | No | No |
| `/mcp/*` | api | Yes (OAuth) | MCP_RATE_LIMITER |
| `/.mcp/*` | api | No | No |
| `/oauth/*` | oauth | No | MCP_RATE_LIMITER |
| `/.well-known/*` | oauth | No | No |
| `/robots.txt` | api | No | No |
| `/llms.txt` | api | No | No |

### 2.3 Service Binding Topology

```
                    ┌─────────────────┐
                    │     router      │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │ HTTP fetch        │ HTTP fetch        │ HTTP fetch
         ▼                   ▼                   ▼
    ┌─────────┐        ┌─────────┐        ┌─────────┐
    │   web   │        │   api   │        │  oauth  │
    └─────────┘        └────┬────┘        └─────────┘
                            │
                            │ RPC (WorkerEntrypoint)
                            ▼
                       ┌─────────┐
                       │  oauth  │
                       └─────────┘
```

**Binding Types:**
- **Router → Web/API/OAuth**: HTTP fetch (simple request forwarding)
- **API → OAuth**: RPC via WorkerEntrypoint (structured method calls)

---

## 3. Worker Specifications

### 3.1 Router Worker (`sentry-mcp-router`)

#### Purpose
Single entry point for all traffic. Handles cross-cutting concerns before dispatching to backend services.

#### Responsibilities
1. **Rate Limiting**: Apply global rate limits before forwarding
2. **CORS**: Add CORS headers for public metadata endpoints
3. **Route Dispatch**: Forward requests to appropriate backend worker
4. **Observability**: Entry point for tracing/logging

#### Request Processing Flow
```
1. Receive request
2. Extract path and method
3. Check rate limit (if applicable route)
4. Add CORS headers (if public metadata endpoint)
5. Dispatch to target worker via service binding
6. Return response (may add headers)
```

#### Bindings
```typescript
interface RouterEnv {
  // Service bindings (HTTP fetch)
  WEB_SERVICE: Fetcher;
  API_SERVICE: Fetcher;
  OAUTH_SERVICE: Fetcher;

  // Rate limiting
  MCP_RATE_LIMITER: RateLimit;
}
```

#### Route Dispatch Logic
```typescript
function getTargetService(path: string): Fetcher {
  if (path.startsWith('/api/')) return env.WEB_SERVICE;
  if (path.startsWith('/mcp')) return env.API_SERVICE;
  if (path.startsWith('/.mcp')) return env.API_SERVICE;
  if (path.startsWith('/oauth')) return env.OAUTH_SERVICE;
  if (path.startsWith('/.well-known')) return env.OAUTH_SERVICE;
  if (path === '/robots.txt' || path === '/llms.txt') return env.API_SERVICE;
  // Default: static assets
  return env.WEB_SERVICE;
}
```

---

### 3.2 Web Worker (`sentry-mcp-web`)

#### Purpose
Serve the React SPA and handle chat-related APIs.

#### Responsibilities
1. **Static Assets**: Serve React SPA with SPA routing fallback
2. **Chat API**: `/api/chat` - AI chat using OpenAI + MCP tools
3. **Search API**: `/api/search` - AutoRAG documentation search
4. **Chat OAuth**: `/api/auth/*` - OAuth client for chat authentication
5. **Metadata**: `/api/metadata` - MCP server info for chat

#### Request Processing Flow
```
/api/chat:
1. Validate auth cookie (sentry_auth_data)
2. Check CHAT_RATE_LIMITER
3. Process chat request with OpenAI
4. Return streaming response

/api/search:
1. Check SEARCH_RATE_LIMITER
2. Query AutoRAG via AI binding
3. Return search results

/api/auth/authorize:
1. Register/get OAuth client from OAUTH_KV
2. Redirect to /oauth/authorize

/api/auth/callback:
1. Validate state parameter
2. Exchange code for token via /oauth/token
3. Set auth cookie
4. Return success page

/* (static):
1. Serve from ASSETS binding
2. SPA fallback for unmatched routes
```

#### Bindings
```typescript
interface WebEnv {
  // Static assets
  ASSETS: Fetcher;

  // AI for AutoRAG
  AI: Ai;

  // Rate limiting
  CHAT_RATE_LIMITER: RateLimit;
  SEARCH_RATE_LIMITER: RateLimit;

  // KV for chat client registration
  OAUTH_KV: KVNamespace;

  // Environment variables
  OPENAI_API_KEY: string;
  SENTRY_DSN?: string;
  AUTORAG_INDEX_NAME?: string;
}
```

#### No Service Bindings to Other Workers
The web worker does NOT need service bindings to other workers because:
- Chat OAuth talks to `/oauth/*` via HTTP (same domain, through router)
- Chat API accesses MCP server via HTTP for tool calls

---

### 3.3 API Worker (`sentry-mcp-api`)

#### Purpose
Handle MCP protocol and execute MCP tools.

#### Responsibilities
1. **MCP Protocol**: `/mcp/*` - Full MCP protocol implementation
2. **MCP Metadata**: `/.mcp/*` - Public tool definitions
3. **SEO**: `/robots.txt`, `/llms.txt`
4. **Token Validation**: Validate OAuth tokens via OAuth service RPC
5. **Constraint Validation**: Verify org/project access

#### Request Processing Flow
```
/mcp/* (MCP Protocol):
1. Parse URL for org/project constraints
2. Extract OAuth token from request
3. Call OAuth service RPC: validateToken(token)
4. If invalid → 401
5. Verify constraint access (org/project)
6. Build MCP server with context
7. Handle MCP request via createMcpHandler
8. Return response

/.mcp/tools.json:
1. Return tool definitions (no auth)

/robots.txt, /llms.txt:
1. Return static content
```

#### Bindings
```typescript
interface ApiEnv {
  // RPC to OAuth service
  OAUTH_SERVICE: OAuthEntrypoint;

  // Environment variables
  SENTRY_HOST?: string;
  MCP_URL?: string;
  SENTRY_DSN?: string;
  OPENAI_API_KEY?: string; // For search_events/search_issues AI agents
}
```

#### OAuth Service RPC Interface
```typescript
interface OAuthEntrypoint {
  // Validate an access token, returns user context if valid
  validateToken(token: string): Promise<TokenValidation | null>;

  // Refresh an access token
  refreshToken(refreshToken: string): Promise<TokenResponse>;

  // Revoke a grant (for legacy token cleanup)
  revokeGrant(grantId: string, userId: string): Promise<void>;

  // List grants for a user
  listUserGrants(userId: string): Promise<{ items: Grant[] }>;
}

interface TokenValidation {
  id: string;           // User ID
  clientId: string;     // OAuth client ID
  accessToken: string;  // The validated token
  refreshToken: string; // For token refresh
  grantedSkills: string[]; // Permissions
  accessTokenExpiresAt?: number;
}
```

---

### 3.4 OAuth Worker (`sentry-mcp-oauth`)

#### Purpose
OAuth 2.1 authorization server that proxies to Sentry OAuth.

#### Responsibilities
1. **Authorization**: `/oauth/authorize` - Consent UI and redirect to Sentry
2. **Callback**: `/oauth/callback` - Handle Sentry callback, store tokens
3. **Token Exchange**: `/oauth/token` - Exchange code for tokens
4. **Client Registration**: `/oauth/register` - Dynamic client registration
5. **Discovery**: `/.well-known/oauth-authorization-server`
6. **Token Management**: Store, validate, refresh tokens in KV
7. **RPC Entrypoint**: Expose methods for API worker to validate tokens

#### Request Processing Flow
```
/oauth/authorize (GET):
1. Validate client_id, redirect_uri, scope
2. Check for existing approval cookie
3. If approved → redirect to Sentry OAuth
4. If not → show approval dialog

/oauth/authorize (POST):
1. Process approval form
2. Set approval cookie
3. Create HMAC-signed state
4. Redirect to Sentry OAuth

/oauth/callback:
1. Verify state signature
2. Exchange code with Sentry
3. Store tokens in KV (encrypted)
4. Redirect back to client with code

/oauth/token:
1. Validate grant_type
2. If authorization_code → exchange and return tokens
3. If refresh_token → refresh via tokenExchangeCallback

RPC validateToken(token):
1. Look up token in provider
2. Return validation result or null
```

#### Bindings
```typescript
interface OAuthEnv {
  // KV for token/grant storage
  OAUTH_KV: KVNamespace;

  // OAuth Provider helpers (from @cloudflare/workers-oauth-provider)
  OAUTH_PROVIDER: OAuthHelpers;

  // Environment variables
  SENTRY_CLIENT_ID: string;
  SENTRY_CLIENT_SECRET: string;
  COOKIE_SECRET: string;
  SENTRY_HOST?: string;
}
```

#### WorkerEntrypoint Implementation
```typescript
import { WorkerEntrypoint } from "cloudflare:workers";

export class OAuthEntrypoint extends WorkerEntrypoint<OAuthEnv> {
  async validateToken(token: string): Promise<TokenValidation | null> {
    // Use OAUTH_PROVIDER to validate token
    // Return user context if valid
  }

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    // Call Sentry token endpoint
    // Update stored tokens
    // Return new tokens
  }

  async revokeGrant(grantId: string, userId: string): Promise<void> {
    // Use OAUTH_PROVIDER.revokeGrant
  }

  async listUserGrants(userId: string): Promise<{ items: Grant[] }> {
    // Use OAUTH_PROVIDER.listUserGrants
  }
}

// Also export default fetch handler for HTTP routes
export default {
  fetch: oauthApp.fetch
};
```

---

## 4. Data Flow Diagrams

### 4.1 MCP Request Flow (OAuth-authenticated)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MCP Client  │     │    Router    │     │     API      │     │    OAuth     │
│ (Cursor/etc) │     │              │     │              │     │              │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ POST /mcp          │                    │                    │
       │ Authorization:     │                    │                    │
       │ Bearer <token>     │                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ Rate limit check   │                    │
       │                    ├──┐                 │                    │
       │                    │  │                 │                    │
       │                    │◄─┘                 │                    │
       │                    │                    │                    │
       │                    │ fetch(request)     │                    │
       │                    ├───────────────────►│                    │
       │                    │                    │                    │
       │                    │                    │ RPC: validateToken │
       │                    │                    ├───────────────────►│
       │                    │                    │                    │
       │                    │                    │  TokenValidation   │
       │                    │                    │◄───────────────────┤
       │                    │                    │                    │
       │                    │                    │ Build MCP server   │
       │                    │                    │ with context       │
       │                    │                    ├──┐                 │
       │                    │                    │  │                 │
       │                    │                    │◄─┘                 │
       │                    │                    │                    │
       │                    │                    │ Execute tool       │
       │                    │                    ├──┐                 │
       │                    │                    │  │                 │
       │                    │                    │◄─┘                 │
       │                    │                    │                    │
       │                    │     Response       │                    │
       │                    │◄───────────────────┤                    │
       │                    │                    │                    │
       │     Response       │                    │                    │
       │◄───────────────────┤                    │                    │
       │                    │                    │                    │
```

### 4.2 OAuth Authorization Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MCP Client  │     │    Router    │     │    OAuth     │     │   Sentry     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ GET /oauth/authorize                    │                    │
       │ ?client_id=...     │                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ fetch(request)     │                    │
       │                    ├───────────────────►│                    │
       │                    │                    │                    │
       │                    │                    │ Show approval UI   │
       │                    │◄───────────────────┤                    │
       │                    │                    │                    │
       │  Approval UI       │                    │                    │
       │◄───────────────────┤                    │                    │
       │                    │                    │                    │
       │ POST /oauth/authorize                   │                    │
       │ (user approves)    │                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ fetch(request)     │                    │
       │                    ├───────────────────►│                    │
       │                    │                    │                    │
       │                    │                    │ Create state,      │
       │                    │                    │ redirect to Sentry │
       │                    │◄───────────────────┤                    │
       │                    │                    │                    │
       │ 302 → Sentry OAuth │                    │                    │
       │◄───────────────────┤                    │                    │
       │                    │                    │                    │
       │ (User authorizes at Sentry)             │                    │
       ├─────────────────────────────────────────────────────────────►│
       │                    │                    │                    │
       │ 302 → /oauth/callback?code=...          │                    │
       │◄─────────────────────────────────────────────────────────────┤
       │                    │                    │                    │
       │ GET /oauth/callback│                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ fetch(request)     │                    │
       │                    ├───────────────────►│                    │
       │                    │                    │                    │
       │                    │                    │ Exchange code      │
       │                    │                    ├───────────────────►│
       │                    │                    │                    │
       │                    │                    │ Tokens             │
       │                    │                    │◄───────────────────┤
       │                    │                    │                    │
       │                    │                    │ Store in KV        │
       │                    │                    │ Redirect to client │
       │                    │◄───────────────────┤                    │
       │                    │                    │                    │
       │ 302 → client       │                    │                    │
       │◄───────────────────┤                    │                    │
```

### 4.3 Chat OAuth Flow (Client-side)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Browser     │     │    Router    │     │     Web      │     │    OAuth     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ GET /api/auth/authorize                 │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ fetch(request)     │                    │
       │                    ├───────────────────►│                    │
       │                    │                    │                    │
       │                    │                    │ Get/register       │
       │                    │                    │ client in OAUTH_KV │
       │                    │                    ├──┐                 │
       │                    │                    │  │                 │
       │                    │                    │◄─┘                 │
       │                    │                    │                    │
       │                    │ 302 → /oauth/authorize                  │
       │                    │◄───────────────────┤                    │
       │                    │                    │                    │
       │ 302 → /oauth/...   │                    │                    │
       │◄───────────────────┤                    │                    │
       │                    │                    │                    │
       │ (OAuth flow via OAuth worker)           │                    │
       ├─────────────────────────────────────────────────────────────►│
       │                    │                    │                    │
       │ 302 → /api/auth/callback?code=...       │                    │
       │◄─────────────────────────────────────────────────────────────┤
       │                    │                    │                    │
       │ GET /api/auth/callback                  │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ fetch(request)     │                    │
       │                    ├───────────────────►│                    │
       │                    │                    │                    │
       │                    │                    │ POST /oauth/token  │
       │                    │                    │ (via HTTP)         │
       │                    │                    ├────────────────────►
       │                    │                    │                    │
       │                    │                    │ Tokens             │
       │                    │                    │◄────────────────────
       │                    │                    │                    │
       │                    │                    │ Set cookie         │
       │                    │◄───────────────────┤                    │
       │                    │                    │                    │
       │ Set-Cookie + HTML  │                    │                    │
       │◄───────────────────┤                    │                    │
```

---

## 5. Configuration Specifications

### 5.1 Router Worker Configuration

```jsonc
// packages/mcp-cloudflare-router/wrangler.jsonc
{
  "name": "sentry-mcp-router",
  "main": "./src/index.ts",
  "compatibility_date": "2025-03-21",
  "compatibility_flags": ["nodejs_compat"],

  // Service bindings to other workers
  "services": [
    { "binding": "WEB_SERVICE", "service": "sentry-mcp-web" },
    { "binding": "API_SERVICE", "service": "sentry-mcp-api" },
    { "binding": "OAUTH_SERVICE", "service": "sentry-mcp-oauth" }
  ],

  // Rate limiting
  "unsafe": {
    "bindings": [
      {
        "name": "MCP_RATE_LIMITER",
        "type": "ratelimit",
        "namespace_id": "1003",
        "simple": { "limit": 60, "period": 60 }
      }
    ]
  },

  "observability": { "enabled": true, "head_sampling_rate": 1 }
}
```

### 5.2 Web Worker Configuration

```jsonc
// packages/mcp-cloudflare-web/wrangler.jsonc
{
  "name": "sentry-mcp-web",
  "main": "./src/server/index.ts",
  "compatibility_date": "2025-03-21",
  "compatibility_flags": ["nodejs_compat", "nodejs_compat_populate_process_env"],

  // Static assets (React SPA)
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },

  // AI for AutoRAG
  "ai": { "binding": "AI" },

  // KV for chat client registration
  "kv_namespaces": [
    { "binding": "OAUTH_KV", "id": "..." }
  ],

  // Rate limiting
  "unsafe": {
    "bindings": [
      { "name": "CHAT_RATE_LIMITER", "type": "ratelimit", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
      { "name": "SEARCH_RATE_LIMITER", "type": "ratelimit", "namespace_id": "1002", "simple": { "limit": 20, "period": 60 } }
    ]
  },

  "observability": { "enabled": true, "head_sampling_rate": 1 }
}
```

### 5.3 API Worker Configuration

```jsonc
// packages/mcp-cloudflare-api/wrangler.jsonc
{
  "name": "sentry-mcp-api",
  "main": "./src/index.ts",
  "compatibility_date": "2025-03-21",
  "compatibility_flags": ["nodejs_compat", "nodejs_compat_populate_process_env"],

  // RPC service binding to OAuth (with entrypoint)
  "services": [
    {
      "binding": "OAUTH_SERVICE",
      "service": "sentry-mcp-oauth",
      "entrypoint": "OAuthEntrypoint"
    }
  ],

  "observability": { "enabled": true, "head_sampling_rate": 1 }
}
```

### 5.4 OAuth Worker Configuration

```jsonc
// packages/mcp-cloudflare-oauth/wrangler.jsonc
{
  "name": "sentry-mcp-oauth",
  "main": "./src/index.ts",
  "compatibility_date": "2025-03-21",
  "compatibility_flags": ["nodejs_compat", "nodejs_compat_populate_process_env"],

  // KV for token storage
  "kv_namespaces": [
    { "binding": "OAUTH_KV", "id": "8dd5e9bafe1945298e2d5ca3b408a553" }
  ],

  "observability": { "enabled": true, "head_sampling_rate": 1 }
}
```

---

## 6. Security Considerations

### 6.1 Token Security
- Tokens stored encrypted in KV (via OAuth provider)
- Token validation via RPC (never exposed to client workers)
- Access tokens short-lived, refresh tokens long-lived

### 6.2 CORS Policy
- Public metadata endpoints: `Access-Control-Allow-Origin: *`
- OAuth endpoints: Same-origin only
- MCP endpoints: Controlled by MCP protocol

### 6.3 Rate Limiting Tiers
| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| `/api/chat` | 10 | 60s | Prevent chat abuse |
| `/api/search` | 20 | 60s | Prevent search abuse |
| `/mcp/*`, `/oauth/*` | 60 | 60s | General API protection |

### 6.4 Service Isolation
- OAuth worker has sole access to KV tokens
- API worker cannot directly access token storage
- Web worker cannot directly access MCP internals

---

## 7. Error Handling

### 7.1 Service Binding Failures
```typescript
// In router
try {
  return await env.API_SERVICE.fetch(request);
} catch (error) {
  // Log to Sentry
  captureException(error);
  return new Response("Service temporarily unavailable", { status: 503 });
}
```

### 7.2 OAuth Validation Failures
```typescript
// In API worker
const validation = await env.OAUTH_SERVICE.validateToken(token);
if (!validation) {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" }
  });
}
```

### 7.3 Rate Limit Responses
```typescript
if (!rateLimitResult.allowed) {
  return new Response("Rate limit exceeded", {
    status: 429,
    headers: { "Retry-After": "60" }
  });
}
```

---

## 8. Local Development

### 8.1 Multi-Worker Development Command
```bash
wrangler dev \
  -c packages/mcp-cloudflare-router/wrangler.jsonc \
  -c packages/mcp-cloudflare-web/wrangler.jsonc \
  -c packages/mcp-cloudflare-api/wrangler.jsonc \
  -c packages/mcp-cloudflare-oauth/wrangler.jsonc
```

- First config (router) is primary at `http://localhost:8787`
- Other workers accessible only via service bindings
- All workers share KV emulation

### 8.2 Environment Variables for Local Dev
```bash
# packages/mcp-cloudflare-oauth/.dev.vars
SENTRY_CLIENT_ID=dev_client_id
SENTRY_CLIENT_SECRET=dev_secret
COOKIE_SECRET=dev-cookie-secret-32-chars-min

# packages/mcp-cloudflare-web/.dev.vars
OPENAI_API_KEY=sk-...

# packages/mcp-cloudflare-api/.dev.vars
OPENAI_API_KEY=sk-...
SENTRY_HOST=sentry.io
```

---

## 9. Deployment Architecture

### 9.1 Deployment Order
For initial deployment:
1. **OAuth** (no dependencies)
2. **Web** (no dependencies)
3. **API** (depends on OAuth)
4. **Router** (depends on all)

### 9.2 Independent Updates
After initial deployment, workers can be updated independently:
- Web changes: deploy web only
- MCP tool changes: deploy api only
- OAuth changes: deploy oauth only
- Routing changes: deploy router only

### 9.3 Rollback Strategy
Each worker version is tracked independently. Rollback via:
```bash
wrangler rollback --name sentry-mcp-api
```

---

## 10. Target Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            Internet Traffic              │
                    └────────────────────┬────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────┐
                    │        mcp-cloudflare-router            │
                    │  (Gateway - rate limiting, routing)      │
                    └───┬────────────────┬────────────────┬───┘
                        │                │                │
         ┌──────────────▼──┐   ┌────────▼────────┐   ┌──▼──────────────┐
         │ mcp-cloudflare- │   │ mcp-cloudflare- │   │ mcp-cloudflare- │
         │      web        │   │       api       │   │      oauth      │
         │ (Static assets, │   │  (MCP protocol, │   │ (OAuth 2.1      │
         │  Chat UI/API)   │   │   tools)        │   │  server, KV)    │
         └─────────────────┘   └────────┬────────┘   └─────────────────┘
                                        │ service binding
                                        ▼
                               ┌─────────────────┐
                               │ mcp-cloudflare- │
                               │      oauth      │
                               └─────────────────┘
```

## 11. Package Structure

```
packages/
├── mcp-cloudflare-router/     # Gateway worker (sentry-mcp-router)
│   ├── src/
│   │   └── index.ts           # Route dispatcher
│   ├── wrangler.jsonc
│   └── package.json
│
├── mcp-cloudflare-web/        # Frontend + Chat APIs (sentry-mcp-web)
│   ├── src/
│   │   ├── client/            # React SPA (moved from current)
│   │   ├── server/
│   │   │   ├── index.ts       # Worker entry
│   │   │   ├── routes/
│   │   │   │   ├── chat.ts    # /api/chat
│   │   │   │   ├── chat-oauth.ts  # /api/auth/*
│   │   │   │   └── search.ts  # /api/search
│   │   │   └── app.ts         # Hono router
│   │   └── constants.ts
│   ├── vite.config.ts
│   ├── wrangler.jsonc
│   └── package.json
│
├── mcp-cloudflare-api/        # MCP Backend (sentry-mcp-api)
│   ├── src/
│   │   ├── index.ts           # Worker entry
│   │   ├── mcp-handler.ts     # MCP protocol handler
│   │   ├── constraint-utils.ts
│   │   └── routes/
│   │       └── mcp.ts         # /.mcp/* metadata
│   ├── wrangler.jsonc
│   └── package.json
│
└── mcp-cloudflare-oauth/      # OAuth Service (sentry-mcp-oauth)
    ├── src/
    │   ├── index.ts           # Worker entry + WorkerEntrypoint
    │   ├── routes/
    │   │   ├── authorize.ts
    │   │   ├── callback.ts
    │   │   └── token.ts
    │   ├── helpers.ts
    │   ├── state.ts
    │   └── constants.ts
    ├── wrangler.jsonc
    └── package.json
```

**Note:** No shared package - types will be duplicated as needed. Re-evaluate if significant duplication emerges.

## 12. Worker Responsibilities

### 12.1 mcp-cloudflare-router (Gateway)
**Routes:**
- `/*` → Forward to appropriate worker

**Responsibilities:**
- Entry point for all requests
- Global rate limiting
- Route dispatching via service bindings
- CORS headers for public endpoints
- Observability/logging entry point

**Bindings:**
- `WEB_SERVICE` → mcp-cloudflare-web
- `API_SERVICE` → mcp-cloudflare-api
- `OAUTH_SERVICE` → mcp-cloudflare-oauth
- `MCP_RATE_LIMITER` → Rate limiter

### 12.2 mcp-cloudflare-web (Frontend)
**Routes:**
- `/` → Static SPA
- `/api/chat` → Chat endpoint
- `/api/search` → AutoRAG search
- `/api/auth/*` → Chat OAuth client flow
- `/api/metadata` → MCP server metadata

**Responsibilities:**
- Serve React SPA (static assets)
- Chat API (uses OpenAI, calls MCP via HTTP)
- Search API (uses AutoRAG)
- Chat OAuth client (registers with OAuth service)

**Bindings:**
- `ASSETS` → Static assets
- `AI` → Workers AI for AutoRAG
- `CHAT_RATE_LIMITER` → Chat rate limiter
- `SEARCH_RATE_LIMITER` → Search rate limiter
- `OAUTH_KV` → For chat client registration storage

### 12.3 mcp-cloudflare-api (MCP Backend)
**Routes:**
- `/mcp/*` → MCP protocol (via createMcpHandler)
- `/.mcp/*` → MCP metadata (tools.json)
- `/robots.txt`, `/llms.txt` → SEO/LLM directives

**Responsibilities:**
- MCP protocol handling
- All 19 MCP tools
- Constraint validation (org/project access)
- Agent mode support

**Bindings:**
- `OAUTH_SERVICE` → OAuth service for token validation (RPC)

### 12.4 mcp-cloudflare-oauth (OAuth Service)
**Routes:**
- `/oauth/authorize` → Authorization page
- `/oauth/callback` → Handle Sentry callback
- `/oauth/token` → Token exchange
- `/oauth/register` → Dynamic client registration
- `/.well-known/oauth-authorization-server` → OAuth metadata

**Responsibilities:**
- OAuth 2.1 server implementation
- Token storage and refresh (KV)
- Client registration
- PKCE support
- Sentry upstream OAuth proxy

**Bindings:**
- `OAUTH_KV` → Token/grant storage

**RPC Entrypoints:**
```typescript
export class OAuthEntrypoint extends WorkerEntrypoint {
  async validateToken(token: string): Promise<TokenValidation>;
  async refreshToken(refreshToken: string): Promise<TokenResponse>;
  async revokeGrant(grantId: string, userId: string): Promise<void>;
}
```

## 13. Service Binding Patterns

### HTTP Service Bindings (fetch)
Used for routing requests between workers:
```typescript
// In router
const response = await env.WEB_SERVICE.fetch(request);
```

### RPC Service Bindings (WorkerEntrypoint)
Used for structured API calls between workers:
```typescript
// In mcp-cloudflare-api calling oauth service
const validation = await env.OAUTH_SERVICE.validateToken(token);
```

## 14. Migration Strategy

**IMPORTANT**: Copy files, don't move them. This ensures we don't accidentally miss behavior. Files may be duplicated across services initially, then cleaned up after verification.

### Phase 1: Create Package Structure
1. Create 4 new packages with basic structure
2. Set up wrangler.jsonc for each
3. Configure service bindings
4. Set up local dev with multi-worker support

### Phase 2: Extract OAuth Service
1. **Copy** entire `src/server/oauth/*` to `mcp-cloudflare-oauth/src/`
2. **Copy** related helpers, types, and constants
3. Initially wrap `@cloudflare/workers-oauth-provider` in its own worker
4. Implement `WorkerEntrypoint` for RPC (token validation, refresh)
5. Test OAuth flows end-to-end
6. **Evaluate**: If library creates friction, refactor to custom implementation
7. Remove unused code after verification

### Phase 3: Extract MCP API
1. **Copy** entire `src/server/` to `mcp-cloudflare-api/src/`
2. **Copy** `src/server/lib/mcp-handler.ts` and dependencies
3. **Copy** constraint validation (`constraint-utils.ts`)
4. Update to call OAuth service via RPC
5. Test MCP protocol
6. Remove unused code (OAuth routes, chat routes, etc.) after verification

### Phase 4: Extract Web Frontend
1. **Copy** entire `src/client/*` to `mcp-cloudflare-web/src/client/`
2. **Copy** entire `src/server/*` to `mcp-cloudflare-web/src/server/`
3. **Copy** chat/search routes and dependencies
4. Update chat OAuth to call OAuth service
5. Test web app
6. Remove unused code (MCP handler, OAuth server routes) after verification

### Phase 5: Create Router
1. Create new router worker with route dispatching
2. **Copy** rate limiting logic from current index.ts
3. Test full stack
4. Update CI/CD

### Phase 6: Cleanup
1. Verify all functionality works in new structure
2. Remove old `mcp-cloudflare` package
3. Update documentation
4. Update deployment workflows

## 15. Deployment Configuration

### CI/CD (GitHub Actions)
Each worker gets its own deploy job with build watch paths:
```yaml
jobs:
  deploy-router:
    if: contains(github.event.paths, 'packages/mcp-cloudflare-router/**')
    # ...

  deploy-web:
    if: contains(github.event.paths, 'packages/mcp-cloudflare-web/**')
    # ...
```

### Cloudflare Dashboard
- Connect repo to each Worker
- Set root directory for each (`packages/mcp-cloudflare-*/`)
- Configure build commands per worker

## 16. Key Files to Modify/Create

### New Files
- `packages/mcp-cloudflare-router/src/index.ts`
- `packages/mcp-cloudflare-router/wrangler.jsonc`
- `packages/mcp-cloudflare-web/src/server/index.ts`
- `packages/mcp-cloudflare-web/wrangler.jsonc`
- `packages/mcp-cloudflare-api/src/index.ts`
- `packages/mcp-cloudflare-api/wrangler.jsonc`
- `packages/mcp-cloudflare-oauth/src/index.ts`
- `packages/mcp-cloudflare-oauth/wrangler.jsonc`

### Files to Copy (copy first, then prune unused code)

**To mcp-cloudflare-oauth:**
- `mcp-cloudflare/src/server/oauth/*` → copy all OAuth server implementation
- `mcp-cloudflare/src/server/types.ts` → copy Env types
- `mcp-cloudflare/src/constants.ts` → copy SCOPES and related constants

**To mcp-cloudflare-api:**
- `mcp-cloudflare/src/server/*` → copy entire server directory
- Keep: mcp-handler.ts, constraint-utils.ts, routes/mcp.ts
- Remove after testing: oauth/*, routes/chat*.ts, routes/search.ts

**To mcp-cloudflare-web:**
- `mcp-cloudflare/src/client/*` → copy entire client directory
- `mcp-cloudflare/src/server/*` → copy entire server directory
- Keep: routes/chat.ts, routes/chat-oauth.ts, routes/search.ts, routes/metadata.ts
- Remove after testing: oauth/* (server), lib/mcp-handler.ts, routes/mcp.ts

**To mcp-cloudflare-router:**
- `mcp-cloudflare/src/server/index.ts` → copy rate limiting logic
- Create new routing dispatcher

### Files to Delete (after migration verified)
- `packages/mcp-cloudflare/` (entire directory, only after all workers verified working)

## 17. Benefits

1. **Separation of Concerns**: Each worker has a single responsibility
2. **Independent Deployability**: Deploy frontend without touching API
3. **Performance**: Static assets served from edge without worker compute
4. **Scaling**: Different workers can have different resource allocations
5. **Security**: OAuth service isolated with minimal attack surface
6. **Maintainability**: Teams can own individual services
7. **Cost**: Zero-latency service bindings, no additional billing

## 18. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Increased complexity | Clear documentation, single-command dev |
| Service binding failures | Health checks, graceful degradation |
| OAuth state management | Thorough testing of auth flows |
| Local dev friction | Multi-worker wrangler command |

## References

- [Service Bindings - RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Developing with Multiple Workers](https://developers.cloudflare.com/workers/development-testing/multi-workers/)
- [Advanced CI/CD Setups](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [Static Assets Configuration](https://developers.cloudflare.com/workers/static-assets/binding/)
