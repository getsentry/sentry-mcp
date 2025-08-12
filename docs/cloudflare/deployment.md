# Deployment

Cloudflare Workers deployment configuration and patterns.

## Architecture Overview

The deployment consists of:
- **Worker**: Main HTTP server with OAuth flow
- **Durable Object**: MCP transport handling WebSocket connections
- **KV Storage**: OAuth token storage
- **Static Assets**: React UI for setup instructions

## Wrangler Configuration

### wrangler.jsonc

```jsonc
{
  "name": "sentry-mcp-oauth",
  "main": "./src/server/index.ts",
  "compatibility_date": "2025-03-21",
  "compatibility_flags": [
    "nodejs_compat",
    "nodejs_compat_populate_process_env"
  ],
  "keep_vars": true,
  
  // Bindings
  "durable_objects": {
    "bindings": [{
      "name": "SENTRY_MCP",
      "class_name": "SentryMCP"
    }]
  },
  "kv_namespaces": [{
    "binding": "KV",
    "id": "your-kv-namespace-id"
  }],
  
  // SPA configuration
  "site": {
    "bucket": "./dist/client"
  }
}
```

### Environment Variables

Required in production:
```bash
SENTRY_CLIENT_ID=your_oauth_app_id
SENTRY_CLIENT_SECRET=your_oauth_app_secret
COOKIE_SECRET=32_char_random_string
SENTRY_HOST=sentry.io  # Optional for self-hosted
```

Development (.dev.vars):
```bash
SENTRY_CLIENT_ID=dev_client_id
SENTRY_CLIENT_SECRET=dev_secret
COOKIE_SECRET=dev-cookie-secret
```

## Durable Object Setup

The MCP transport runs as a Durable Object:

```typescript
export class SentryMCP extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      
      await this.handleWebSocket(server);
      return new Response(null, { 
        status: 101, 
        webSocket: client 
      });
    }
    
    return new Response("Not found", { status: 404 });
  }
}
```

## OAuth Provider Setup

Configure the OAuth provider with required scopes:

```typescript
const oAuthProvider = new OAuthProvider({
  clientId: env.SENTRY_CLIENT_ID,
  clientSecret: env.SENTRY_CLIENT_SECRET,
  oauthUrl: `https://${env.SENTRY_HOST}/api/0/authorize/`,
  tokenUrl: `https://${env.SENTRY_HOST}/api/0/token/`,
  redirectUrl: `${new URL(request.url).origin}/auth/sentry/callback`,
  scope: ["org:read", "project:read", "issue:read", "issue:write"]
});
```

## Deployment Commands

### Local Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Access at http://localhost:8787
```

### Production Deployment

#### Automated via GitHub Actions (Recommended)

Production deployments happen automatically when changes are pushed to the main branch:

1. Push to main or merge a PR
2. GitHub Actions runs tests
3. If tests pass, deploys to Cloudflare

Required secrets in GitHub repository settings:
- `CLOUDFLARE_API_TOKEN` - API token with Workers deployment permissions
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID
- `SENTRY_AUTH_TOKEN` - For source map uploads during build

See `github-actions.mdc` for detailed setup instructions.

#### Manual Deployment

```bash
# Build client assets
pnpm build

# Deploy to Cloudflare
pnpm deploy

# Or deploy specific environment
pnpm deploy --env production
```

#### Preview Environments

For pull requests, GitHub Actions automatically creates isolated preview environments:

1. Open or update a pull request
2. Tests run automatically
3. If tests pass, deploys to a preview environment
4. Preview environment is **completely isolated** from production
5. Smoke tests run against the preview URL
6. Results are posted as a PR comment
7. Preview is accessible via: `https://sentry-mcp-preview-{branch}.getsentry.workers.dev`

Manual preview deployment:
```bash
# Deploy to a preview environment
npx wrangler deploy --env preview-feature-branch
# Creates: sentry-mcp-preview-feature-branch.getsentry.workers.dev
```

To deploy a specific version to production:
```bash
# After validation, deploy to production
npx wrangler versions deploy VERSION_ID@100 --message "Production deployment"
```

Gradual rollout example:
```bash
# Start with 10% of traffic
npx wrangler versions deploy abc123@10 --message "Testing rollout"

# Increase to 50%
npx wrangler versions deploy abc123@50 --message "Expanding rollout"

# Full deployment
npx wrangler versions deploy abc123@100 --message "Full deployment"
```

The preview environment approach ensures:
- Complete isolation from production
- Separate Worker instance for each branch
- Safe testing of potentially breaking changes
- Clean URLs based on branch names (e.g., `sentry-mcp-preview-feat-oauth.getsentry.workers.dev`)
- Branch names are sanitized: lowercase, alphanumeric with hyphens, max 20 chars
- Automatic cleanup when PR is closed (manual deletion of environment)

### Smoke Tests

Pull request deployments automatically run smoke tests to validate the deployment:

```bash
# Run smoke tests manually
cd packages/smoke-tests
PREVIEW_URL=https://sentry-mcp.workers.dev pnpm test
```

Tests validate (using Vitest):
- Root endpoint availability (200 response)
- MCP endpoint exists (returns auth error, not 404)
- Metadata API endpoint (401 without auth)
- Chat API endpoint (accepts POST requests)
- OAuth endpoint accessibility
- Static assets (robots.txt, llms.txt)
- Response time performance (<2 seconds)
- Security headers configuration

### Creating Resources

First-time setup:
```bash
# Create KV namespace
npx wrangler kv:namespace create KV

# Create Durable Object namespace
npx wrangler durable-objects namespace create SENTRY_MCP

# Update wrangler.jsonc with IDs
```

## Multi-Region Considerations

Cloudflare Workers run globally, but consider:
- Durable Objects have a home region
- KV is eventually consistent globally
- Use regional hints for performance

## Security Configuration

### CORS Settings

```typescript
const ALLOWED_ORIGINS = [
  "https://sentry.io",
  "https://*.sentry.io"
];

// Apply to responses
response.headers.set("Access-Control-Allow-Origin", origin);
response.headers.set("Access-Control-Allow-Credentials", "true");
```

### Cookie Configuration

```typescript
// Secure cookie settings
"HttpOnly; Secure; SameSite=Lax; Max-Age=2592000"
```

## Monitoring

### Sentry Integration

```typescript
// sentry.config.ts
export default {
  dsn: env.VITE_SENTRY_DSN,
  environment: env.VITE_SENTRY_ENVIRONMENT || "development",
  integrations: [
    Sentry.rewriteFramesIntegration({
      root: "/",
    }),
  ],
  transportOptions: {
    sendClientReports: false,
  },
};
```

### Worker Analytics

Monitor via Cloudflare dashboard:
- Request rates
- Error rates
- Durable Object usage
- KV operations

## Troubleshooting

### Common Issues

1. **OAuth redirect mismatch**
   - Ensure callback URL matches Sentry app config
   - Check protocol (http vs https)

2. **Durable Object not found**
   - Verify namespace binding in wrangler.jsonc
   - Check class export in main file

3. **Environment variables missing**
   - Use `wrangler secret put` for production
   - Check `.dev.vars` for local development

## References

- Worker code: `packages/mcp-cloudflare/src/server/`
- Client UI: `packages/mcp-cloudflare/src/client/`
- Wrangler config: `packages/mcp-cloudflare/wrangler.jsonc`
- Cloudflare docs: https://developers.cloudflare.com/workers/