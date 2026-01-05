# AGENTS.md - FastMCP HTTP OAuth Subproject

This is an **isolated subproject** within the sentry-mcp monorepo. It provides a standalone Docker-based deployment of the Sentry MCP server using HTTP Streamable transport with OAuth 2.1 authentication.

## Key Principles

### Isolation from Parent Project

**CRITICAL**: This subproject is intentionally isolated from the parent monorepo to:
- Allow standalone deployment without the full monorepo
- Avoid polluting the parent project's dependencies
- Enable independent development and testing

**All development work must be done via Docker Compose commands.** Do NOT:
- Run `pnpm install` in the parent directory for this subproject
- Modify parent `package.json` or `pnpm-workspace.yaml`
- Add dependencies to the parent project for this subproject's needs

### Docker-First Development

**Every action must go through docker compose:**

```bash
# Build the containers
docker compose build

# Start services
docker compose up -d

# View logs
docker compose logs -f sentry-mcp

# Run tests (uses dedicated 'test' service)
docker compose run --rm test

# Type checking
docker compose run --rm test pnpm typecheck

# Stop services
docker compose down

# Clean rebuild
docker compose build --no-cache
```

## Architecture Overview

```
fastmcp-http-oauth/
├── server.ts              # Main server entry point
├── redis-token-storage.ts # TokenStorage implementation for Redis/Valkey
├── docker-compose.yml     # Service definitions (sentry-mcp + valkey)
├── Dockerfile             # Multi-stage build
├── package.json           # Subproject-specific dependencies
├── tsconfig.json          # TypeScript config
├── .env.example           # Environment template
├── .env                   # Local environment (gitignored)
├── custom-cas/            # Custom CA certificates (for self-signed certs)
├── __tests__/             # Unit tests
└── helm/                  # Helm chart for Kubernetes deployment
    └── sentry-mcp/        # Chart directory
```

### How It Works

1. **FastMCP Server** (`server.ts`):
   - Creates HTTP Streamable MCP server using FastMCP library
   - Configures OAuth 2.1 proxy for upstream Sentry authentication
   - Registers all tools from `mcp-core` package
   - Runs in stateless mode for horizontal scaling

2. **Redis Token Storage** (`redis-token-storage.ts`):
   - Implements `TokenStorage` interface from FastMCP
   - Stores OAuth tokens encrypted in Redis/Valkey
   - Enables distributed deployments with shared token state

3. **Docker Compose** (`docker-compose.yml`):
   - `sentry-mcp`: The MCP server container
   - `valkey`: Redis-compatible token storage

### Dependency on mcp-core

The server imports tools from `../packages/mcp-core/dist/`. The Dockerfile:
1. Builds mcp-core in the parent context
2. Copies only the `dist/` folder into the container
3. Sets up proper module resolution via symlinks

## Commands Reference

### Building

```bash
# Standard build (uses parent build context)
docker compose build

# Force rebuild without cache
docker compose build --no-cache

# Build with specific platform
docker compose build --platform linux/amd64
```

### Running

```bash
# Start in background
docker compose up -d

# Start with logs
docker compose up

# Start only specific service
docker compose up valkey
```

### Testing

```bash
# Run all tests (uses the 'test' service with pnpm available)
docker compose run --rm test

# Run tests with coverage
docker compose run --rm test pnpm test:coverage

# Run specific test file
docker compose run --rm test pnpm test redis-token-storage.test.ts

# Type check
docker compose run --rm test pnpm typecheck
```

### Debugging

```bash
# Interactive shell in container
docker compose run --rm sentry-mcp sh

# View logs
docker compose logs -f sentry-mcp

# Enable debug logging
LOG_LEVEL=debug docker compose up

# Check Redis
docker compose exec valkey valkey-cli
```

### Cleanup

```bash
# Stop all services
docker compose down

# Stop and remove volumes
docker compose down -v

# Remove built images
docker compose down --rmi local
```

## Testing Requirements

### Mandatory Testing Protocol

**Before submitting any changes, you MUST:**

1. **Run all tests:**
   ```bash
   docker compose run --rm test
   ```

2. **Run type checking:**
   ```bash
   docker compose run --rm test pnpm typecheck
   ```

3. **Verify the server starts:**
   ```bash
   docker compose up -d
   docker compose logs sentry-mcp | grep "Server running"
   ```

### Writing Tests

All tests go in the `__tests__/` directory. Follow these patterns:

```typescript
// __tests__/your-module.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("YourModule", () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it("should do something", () => {
    // Test implementation
  });
});
```

### Test Coverage Requirements

- New code must have corresponding tests
- Test edge cases and error conditions
- Mock external dependencies (Redis, Sentry API)
- Use Vitest's `vi.mock()` for module mocking

### When to Add Tests

Add tests when:
- Adding new functionality
- Fixing bugs (add regression test)
- Changing existing behavior
- Modifying `redis-token-storage.ts`
- Modifying configuration loading in `server.ts`

## Common Development Tasks

### Adding a New Environment Variable

1. Add to `.env.example` with documentation
2. Add to `docker-compose.yml` environment section
3. Update `loadConfig()` in `server.ts`
4. Add validation test in `__tests__/config.test.ts`

### Modifying Token Storage

1. Update `redis-token-storage.ts`
2. Add/update tests in `__tests__/redis-token-storage.test.ts`
3. Run: `docker compose run --rm test`

### Updating Dependencies

1. Edit `package.json` in this directory (NOT parent)
2. Rebuild: `docker compose build --no-cache`
3. Test: `docker compose run --rm test`

### Testing OAuth Flow

```bash
# Start server
docker compose up -d

# Check OAuth discovery
curl http://localhost:3000/.well-known/oauth-authorization-server

# Check health
curl http://localhost:3000/health
```

## Troubleshooting

### Build Failures

```bash
# Error: Cannot find mcp-core
# Solution: Build parent first
cd .. && pnpm -w run build && cd fastmcp-http-oauth
docker compose build
```

### Redis Connection Issues

```bash
# Check if Valkey is running
docker compose ps valkey

# Test Redis connection
docker compose exec valkey valkey-cli ping
```

### Module Resolution Errors

```bash
# Clear node_modules and rebuild
docker compose build --no-cache
```

## File Descriptions

| File | Purpose |
|------|---------|
| `server.ts` | Main entry point, creates FastMCP server with OAuth |
| `redis-token-storage.ts` | TokenStorage implementation for distributed deployments |
| `docker-compose.yml` | Service orchestration (MCP server + Valkey) |
| `Dockerfile` | Multi-stage build for production |
| `package.json` | Dependencies (isolated from parent) |
| `tsconfig.json` | TypeScript configuration |
| `.env.example` | Environment variable template |
| `custom-cas/` | Directory for custom CA certificates |

## Security Considerations

- OAuth tokens are encrypted at rest using `ENCRYPTION_KEY`
- JWT tokens signed with `JWT_SIGNING_KEY`
- Redis connections support TLS
- Non-root user in production container
- `ALLOWED_REDIRECT_URI_PATTERNS` restricts OAuth callbacks

## Kubernetes Deployment (Helm)

A Helm chart is provided in `helm/sentry-mcp/` for Kubernetes deployments.

### Chart Structure

```
helm/sentry-mcp/
├── Chart.yaml           # Chart metadata
├── values.yaml          # Default values
├── .helmignore          # Files to ignore
└── templates/
    ├── _helpers.tpl     # Template helpers
    ├── deployment.yaml  # Main deployment
    ├── service.yaml     # Service definition
    ├── configmap.yaml   # Non-secret config (optional)
    ├── secret.yaml      # Secret config (optional)
    ├── pdb.yaml         # PodDisruptionBudget
    ├── serviceaccount.yaml
    ├── ingress.yaml     # Ingress (optional)
    ├── hpa.yaml         # HorizontalPodAutoscaler (optional)
    └── NOTES.txt        # Post-install notes
```

### Installation

```bash
# Basic install (NOT for production - secrets in values)
helm install sentry-mcp ./helm/sentry-mcp \
  --set config.baseUrl=https://mcp.example.com \
  --set config.sentryHost=sentry.io \
  --set config.sentryClientId=your-client-id \
  --set secrets.sentryClientSecret=your-secret \
  --set secrets.encryptionKey=$(openssl rand -base64 32) \
  --set secrets.jwtSigningKey=$(openssl rand -base64 32)

# Production install with existing secret
helm install sentry-mcp ./helm/sentry-mcp \
  --set config.baseUrl=https://mcp.example.com \
  --set config.sentryHost=sentry.io \
  --set config.sentryClientId=your-client-id \
  --set existingSecret=my-sentry-mcp-secrets
```

### Using Existing Secrets

For production, create your secrets separately and reference them:

```bash
# Create secret (one-time)
kubectl create secret generic my-sentry-mcp-secrets \
  --from-literal=SENTRY_CLIENT_SECRET=your-secret \
  --from-literal=ENCRYPTION_KEY=$(openssl rand -base64 32) \
  --from-literal=JWT_SIGNING_KEY=$(openssl rand -base64 32) \
  --from-literal=OPENAI_API_KEY=sk-xxx  # optional

# Install with existing secret
helm install sentry-mcp ./helm/sentry-mcp \
  --set existingSecret=my-sentry-mcp-secrets \
  --set config.baseUrl=https://mcp.example.com \
  --set config.sentryHost=sentry.io \
  --set config.sentryClientId=your-client-id
```

### Using Existing ConfigMap

You can also use an existing ConfigMap for non-secret values:

```bash
# Create configmap
kubectl create configmap my-sentry-mcp-config \
  --from-literal=PORT=3000 \
  --from-literal=HOST=0.0.0.0 \
  --from-literal=BASE_URL=https://mcp.example.com \
  --from-literal=SENTRY_HOST=sentry.io \
  --from-literal=SENTRY_CLIENT_ID=your-client-id \
  --from-literal=REDIS_URL=redis://redis:6379

# Install with existing configmap
helm install sentry-mcp ./helm/sentry-mcp \
  --set existingConfigMap=my-sentry-mcp-config \
  --set existingSecret=my-sentry-mcp-secrets
```

### Key Values

| Value | Description | Required |
|-------|-------------|----------|
| `config.baseUrl` | External URL (for OAuth callbacks) | Yes |
| `config.sentryHost` | Sentry instance hostname | Yes |
| `config.sentryClientId` | Sentry OAuth client ID | Yes |
| `config.redisUrl` | Redis/Valkey URL | No (default: redis://valkey:6379) |
| `existingSecret` | Name of existing K8s Secret | Recommended for prod |
| `existingConfigMap` | Name of existing K8s ConfigMap | Optional |
| `podDisruptionBudget.enabled` | Enable PDB | Yes (default: true) |
| `podDisruptionBudget.maxUnavailable` | Max unavailable pods | No (default: 1) |

### Required Secret Keys

When using `existingSecret`, your secret must contain:
- `SENTRY_CLIENT_SECRET` - Sentry OAuth client secret
- `ENCRYPTION_KEY` - Token encryption key (generate with `openssl rand -base64 32`)
- `JWT_SIGNING_KEY` - JWT signing key (generate with `openssl rand -base64 32`)
- `OPENAI_API_KEY` - (optional) OpenAI API key for AI-powered tools

### PodDisruptionBudget

The PDB is enabled by default to ensure high availability:

```yaml
podDisruptionBudget:
  enabled: true
  maxUnavailable: 1
  # Or use minAvailable instead:
  # minAvailable: 1
```

### Upgrading

```bash
# Upgrade with new values
helm upgrade sentry-mcp ./helm/sentry-mcp --reuse-values \
  --set image.tag=v1.2.0

# See what would change
helm diff upgrade sentry-mcp ./helm/sentry-mcp --reuse-values \
  --set image.tag=v1.2.0
```

### Uninstalling

```bash
helm uninstall sentry-mcp
```

## Integration with Parent Project

This subproject:
- **DOES** import from `mcp-core` (via Docker COPY)
- **DOES NOT** use parent's node_modules
- **DOES NOT** appear in parent's pnpm workspace
- **DOES NOT** affect parent's build or test commands

The Dockerfile handles the mcp-core dependency by copying the built distribution from the parent project during the Docker build process.
