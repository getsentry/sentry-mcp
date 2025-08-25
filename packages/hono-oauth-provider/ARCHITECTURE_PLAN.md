# Hono OAuth Provider - Final Architecture Plan

## 🎯 Expected Final Outcome

This document defines the target architecture for the Hono OAuth 2.1 Provider/Proxy middleware with properly organized components, tests, and storage adapters.

## 📁 Target Directory Structure

```
hono-oauth-provider/
├── src/
│   ├── index.ts                    # Main exports
│   ├── oauth-provider.ts           # Main provider class
│   ├── types.ts                    # TypeScript interfaces
│   │
│   ├── storage/                    # Storage adapters
│   │   ├── index.ts               # Storage exports
│   │   ├── memory.ts              # In-memory storage (testing)
│   │   ├── cloudflare-kv.ts       # Cloudflare KV adapter
│   │   └── redis.ts               # Redis adapter (future)
│   │
│   ├── routes/                     # Route handlers (broken up by endpoint)
│   │   ├── index.ts               # Route registration
│   │   ├── authorize.ts           # GET/POST /authorize
│   │   ├── token.ts               # POST /token
│   │   ├── introspect.ts          # POST /introspect
│   │   ├── revoke.ts              # POST /revoke
│   │   ├── register.ts            # POST /register
│   │   ├── userinfo.ts            # GET /userinfo (future)
│   │   └── discovery.ts           # GET /.well-known/oauth-authorization-server
│   │
│   ├── handlers/                   # Business logic (separated from routes)
│   │   ├── authorization.ts       # Authorization logic
│   │   ├── token-exchange.ts      # Token exchange/refresh logic
│   │   ├── client-auth.ts         # Client authentication
│   │   ├── pkce.ts                # PKCE validation
│   │   └── grant-lifecycle.ts     # Grant management
│   │
│   ├── core/                       # Core functionality
│   │   ├── consent.ts             # Consent management
│   │   ├── session.ts             # Session management
│   │   └── grant-family.ts        # Grant family tracking
│   │
│   ├── lib/                        # Utilities
│   │   ├── crypto.ts              # Cryptographic operations
│   │   ├── crypto-context.ts      # Context encryption (proxy)
│   │   ├── utils.ts               # Token generation, etc.
│   │   ├── validation.ts          # Input validation schemas
│   │   └── errors.ts              # OAuth error responses
│   │
│   └── middleware/                 # Hono middleware
│       ├── auth.ts                # Bearer token authentication
│       ├── rate-limit.ts          # Rate limiting
│       ├── cors.ts                # CORS configuration
│       └── logging.ts             # Request logging
│
├── tests/                          # Test suite (organized by purpose)
│   ├── unit/                      # Unit tests
│   │   ├── handlers/              # Handler logic tests
│   │   │   ├── authorization.test.ts
│   │   │   ├── token-exchange.test.ts
│   │   │   ├── client-auth.test.ts
│   │   │   └── pkce.test.ts
│   │   ├── core/                  # Core functionality tests
│   │   │   ├── consent.test.ts
│   │   │   ├── session.test.ts
│   │   │   └── grant-family.test.ts
│   │   └── lib/                   # Utility tests
│   │       ├── crypto.test.ts
│   │       ├── utils.test.ts
│   │       └── validation.test.ts
│   │
│   ├── integration/               # Integration tests
│   │   ├── routes/                # Route endpoint tests
│   │   │   ├── authorize.test.ts
│   │   │   ├── token.test.ts
│   │   │   ├── introspect.test.ts
│   │   │   ├── revoke.test.ts
│   │   │   └── register.test.ts
│   │   ├── flows/                 # End-to-end flow tests
│   │   │   ├── authorization-code.test.ts
│   │   │   ├── refresh-token.test.ts
│   │   │   └── client-registration.test.ts
│   │   └── storage/               # Storage adapter tests
│   │       ├── memory.test.ts
│   │       └── cloudflare-kv.test.ts
│   │
│   ├── security/                  # Security-focused tests
│   │   ├── race-conditions.test.ts
│   │   ├── timing-attacks.test.ts
│   │   ├── token-security.test.ts
│   │   ├── authorization-lifetime.test.ts
│   │   ├── redirect-uri.test.ts
│   │   └── pkce-enforcement.test.ts
│   │
│   ├── compliance/                # OAuth 2.1 spec compliance
│   │   ├── oauth21-core.test.ts
│   │   ├── rfc6749.test.ts       # OAuth 2.0 base
│   │   ├── rfc7636.test.ts       # PKCE
│   │   ├── rfc7662.test.ts       # Introspection
│   │   └── rfc7009.test.ts       # Revocation
│   │
│   ├── fixtures/                  # Test fixtures
│   │   ├── clients.ts
│   │   ├── tokens.ts
│   │   └── grants.ts
│   │
│   └── helpers/                   # Test utilities
│       ├── setup.ts               # Test environment setup
│       ├── storage.ts             # Storage test helpers
│       └── oauth-client.ts        # OAuth client simulator
│
├── examples/                      # Usage examples
│   ├── basic-server.ts           # Basic OAuth server
│   ├── with-proxy.ts             # OAuth proxy setup
│   ├── cloudflare-worker.ts     # Cloudflare deployment
│   └── custom-storage.ts         # Custom storage adapter
│
└── docs/                         # Documentation
    ├── api/                      # API reference
    │   ├── endpoints.md
    │   ├── errors.md
    │   └── types.md
    ├── guides/                   # How-to guides
    │   ├── getting-started.md
    │   ├── deployment.md
    │   ├── migration.md
    │   └── security.md
    └── architecture/             # Architecture docs
        ├── overview.md
        ├── storage-adapters.md
        └── oauth-proxy.md
```

## 🔧 Component Breakdown

### 1. Route Handlers (`src/routes/`)

Each route file should be minimal, only handling HTTP request/response:

```typescript
// src/routes/authorize.ts
import type { Context } from 'hono';
import { AuthorizationHandler } from '../handlers/authorization';

export class AuthorizeRoute {
  constructor(private handler: AuthorizationHandler) {}

  async get(c: Context) {
    const params = Object.fromEntries(new URL(c.req.url).searchParams);
    return this.handler.showConsentScreen(c, params);
  }

  async post(c: Context) {
    const formData = await c.req.formData();
    return this.handler.processConsent(c, formData);
  }
}
```

### 2. Business Logic Handlers (`src/handlers/`)

Handlers contain the actual OAuth logic, separated from HTTP concerns:

```typescript
// src/handlers/authorization.ts
export class AuthorizationHandler {
  constructor(
    private storage: Storage,
    private config: OAuth21Config,
    private consentManager: ConsentManager
  ) {}

  async showConsentScreen(c: Context, params: AuthorizeParams) {
    // Validation logic
    // Client verification
    // Consent check
    // Return HTML or redirect
  }

  async processConsent(c: Context, formData: FormData) {
    // CSRF validation
    // Consent storage
    // Grant creation
    // Code generation
    // Redirect with code
  }
}
```

### 3. Storage Adapters (`src/storage/`)

Standardized storage implementations:

```typescript
// src/storage/memory.ts
export class MemoryStorage implements Storage {
  private store = new Map<string, any>();
  private timers = new Map<string, NodeJS.Timeout>();
  
  // Full implementation with TTL support
  // Single source of truth for all tests
}

// src/storage/cloudflare-kv.ts
export class CloudflareKVStorage implements Storage {
  constructor(private kv: KVNamespace) {}
  
  // Direct mapping to KV API
  // Production-ready implementation
}
```

### 4. Test Organization

#### Unit Tests (`tests/unit/`)
- Test individual functions/methods in isolation
- Mock all dependencies
- Fast execution
- Example: Testing PKCE verification logic

#### Integration Tests (`tests/integration/`)
- Test complete endpoints with real storage
- Use MemoryStorage
- Verify request/response cycles
- Example: Testing full /token endpoint

#### Security Tests (`tests/security/`)
- Focus on security vulnerabilities
- Race conditions, timing attacks
- Token security
- Example: Concurrent authorization code usage

#### Compliance Tests (`tests/compliance/`)
- Verify OAuth 2.1 spec compliance
- Test against RFC requirements
- Edge cases from specifications
- Example: PKCE requirement for public clients

## 📋 Migration TODO List

### Phase 1: Storage Adapters ✅ CRITICAL

1. **Create `src/storage/` directory**
   ```bash
   mkdir -p src/storage
   ```

2. **Implement storage adapters**
   - [ ] Create `src/storage/index.ts` with exports
   - [ ] Move MemoryStorage to `src/storage/memory.ts`
   - [ ] Move CloudflareKVStorage to `src/storage/cloudflare-kv.ts`
   - [ ] Add proper TTL support to MemoryStorage

3. **Update all imports**
   - [ ] Replace all duplicate storage implementations
   - [ ] Update test files to import from storage module
   - [ ] Update examples to use storage adapters

### Phase 2: Route/Handler Separation 🔄 IMPORTANT

1. **Create `src/routes/` directory**
   - [ ] Move route handling from handlers to routes
   - [ ] Keep routes thin (HTTP only)
   - [ ] Create index.ts for route registration

2. **Refactor handlers**
   - [ ] Move business logic to handlers
   - [ ] Remove HTTP concerns from handlers
   - [ ] Make handlers testable without HTTP context

3. **Update OAuthProvider class**
   - [ ] Use route classes for endpoint registration
   - [ ] Inject handlers into routes
   - [ ] Clean dependency injection

### Phase 3: Test Reorganization 📦 NECESSARY

1. **Create new test structure**
   ```bash
   mkdir -p tests/{unit,integration,security,compliance}
   mkdir -p tests/{fixtures,helpers}
   ```

2. **Migrate tests by category**
   - [ ] Move handler tests to `tests/unit/handlers/`
   - [ ] Move endpoint tests to `tests/integration/routes/`
   - [ ] Move security tests to `tests/security/`
   - [ ] Move compliance tests to `tests/compliance/`

3. **Clean up old tests**
   - [ ] Delete `__tests__/*.test.ts` (outdated API)
   - [ ] Delete duplicate test utilities
   - [ ] Consolidate test fixtures

### Phase 4: Documentation 📚 HELPFUL

1. **API Documentation**
   - [ ] Document all public APIs
   - [ ] Create TypeDoc comments
   - [ ] Generate API reference

2. **Guides**
   - [ ] Getting started guide
   - [ ] Deployment guide for Cloudflare
   - [ ] Migration from other providers

3. **Architecture docs**
   - [ ] Document storage adapter pattern
   - [ ] Explain OAuth proxy functionality
   - [ ] Security best practices

## 🎯 Success Criteria

### Code Quality
- ✅ No duplicate code (especially storage implementations)
- ✅ Clear separation of concerns (routes vs handlers vs core)
- ✅ Testable components (can test handlers without HTTP)
- ✅ Type-safe throughout

### Test Coverage
- ✅ >90% unit test coverage
- ✅ All endpoints have integration tests
- ✅ All security concerns have specific tests
- ✅ OAuth 2.1 compliance verified

### Documentation
- ✅ Every public API documented
- ✅ Examples for common use cases
- ✅ Clear deployment instructions
- ✅ Migration guides available

### Performance
- ✅ Storage operations are async
- ✅ No blocking operations
- ✅ Efficient token validation
- ✅ Proper caching where appropriate

## 🚀 Benefits of This Architecture

1. **Maintainability**
   - Clear separation of concerns
   - Easy to find and fix issues
   - Modular components

2. **Testability**
   - Can test business logic without HTTP
   - Storage adapters can be mocked
   - Clear test categories

3. **Extensibility**
   - Easy to add new storage adapters
   - Simple to add new endpoints
   - Middleware can be composed

4. **Production Ready**
   - Cloudflare KV support built-in
   - Security best practices
   - OAuth 2.1 compliant

## 📅 Implementation Priority

1. **Week 1**: Storage adapters (eliminate duplication)
2. **Week 2**: Route/handler separation
3. **Week 3**: Test reorganization
4. **Week 4**: Documentation and examples

This architecture provides a clean, maintainable, and production-ready OAuth 2.1 provider for Hono applications.