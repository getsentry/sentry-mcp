# GitHub Actions

CI/CD workflows for the Sentry MCP project.

## Workflows

### test.yml
Runs on all pushes to main and pull requests:
- Build, lint, unit tests
- Code coverage reporting

### deploy.yml
Runs after tests pass on main branch:
- **Canary deployment**: Deploy to `sentry-mcp-canary` worker with isolated resources
- **Smoke tests**: Test canary deployment
- **Production deployment**: Deploy to `sentry-mcp` worker (only if canary tests pass)
- **Production smoke tests**: Test production deployment
- **Automatic rollback**: Rollback production if smoke tests fail

### eval.yml
Runs evaluation tests against the MCP server.

## Required Secrets

Repository secrets (no environment needed):

- **`CLOUDFLARE_API_TOKEN`** - Cloudflare API token with Workers deployment permissions
- **`CLOUDFLARE_ACCOUNT_ID`** - Your Cloudflare account ID  
- **`SENTRY_AUTH_TOKEN`** - For Sentry release tracking
- **`SENTRY_CLIENT_SECRET`** - Sentry OAuth client secret
- **`COOKIE_SECRET`** - Session cookie encryption secret
- **`OPENAI_API_KEY`** - For AI-powered search features

## Deployment Architecture

### Workers
- **`sentry-mcp`** - Production worker at `https://mcp.sentry.dev`
- **`sentry-mcp-canary`** - Canary worker at `https://sentry-mcp-canary.getsentry.workers.dev`

### Resource Isolation
Canary and production use separate resources for complete isolation:

| Resource | Production | Canary |
|----------|------------|---------|
| KV Namespace | `8dd5e9bafe1945298e2d5ca3b408a553` | `a3fe0d23b2d34416930e284362a88a3b` |
| Rate Limiter IDs | `1001`, `1002` | `2001`, `2002` |
| Wrangler Config | `wrangler.jsonc` | `wrangler.canary.jsonc` |

### Deployment Flow
1. **Build once** - Single build for both deployments
2. **Deploy canary** - `wrangler deploy --config wrangler.canary.jsonc`
3. **Wait 30s** - Allow propagation
4. **Test canary** - Run smoke tests against canary worker
5. **Deploy production** - `wrangler deploy` (only if canary tests pass)
6. **Wait 30s** - Allow propagation  
7. **Test production** - Run smoke tests against production worker
8. **Rollback** - `wrangler rollback` if production tests fail

## Manual Deployment

Trigger via GitHub Actions → Deploy to Cloudflare → "Run workflow"

## Troubleshooting

1. **Authentication failed** - Check `CLOUDFLARE_API_TOKEN` permissions
2. **Build failures** - Review TypeScript/build logs
3. **Smoke test failures** - Check worker logs in Cloudflare dashboard