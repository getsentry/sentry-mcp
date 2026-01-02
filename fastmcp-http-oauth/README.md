# Sentry MCP Server - HTTP Streamable Transport with OAuth 2.1

A standalone MCP server for Sentry that provides:

- **HTTP Streamable** transport (MCP spec 2025-03-26)
- **OAuth 2.1** with PKCE via OAuth Proxy
- **Self-hosted deployment** without Cloudflare dependencies
- **Stateless architecture** with Redis/Valkey for distributed deployments

## Why Use This?

The main Sentry MCP server (`@sentry/mcp-server`) uses stdio transport and is designed for local IDE integrations (Claude Desktop, Cursor, VS Code). This variant provides:

1. **HTTP-based transport** - Works with web-based MCP clients and services that need HTTP endpoints
2. **OAuth 2.1 authentication** - Secure token-based auth instead of static API keys
3. **Self-hosted** - No Cloudflare Workers dependency; runs anywhere Docker runs
4. **Horizontal scaling** - Fully stateless; scale with load balancers and shared Redis

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  MCP Client (any HTTP-compatible client)                    │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP Streamable + OAuth 2.1
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Sentry MCP Server (this service)                           │
│  ├── /mcp                   - MCP HTTP Streamable endpoint  │
│  ├── /health                - Health check                  │
│  ├── /.well-known/*         - OAuth discovery               │
│  ├── /oauth/register        - Dynamic Client Registration   │
│  ├── /oauth/authorize       - OAuth authorization           │
│  ├── /oauth/token           - Token exchange                │
│  └── /oauth/callback        - OAuth callback                │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
┌──────────────────┐         ┌──────────────────────────────┐
│  Redis/Valkey    │         │  Sentry Instance             │
│  (Token Storage) │         │  (OAuth Provider + API)      │
└──────────────────┘         └──────────────────────────────┘
```

## Quick Start with Docker Compose

### 1. Prerequisites

- Docker and Docker Compose
- Sentry instance (self-hosted or SaaS) with OAuth application configured

### 2. Configure Sentry OAuth Application

Create an OAuth application in your Sentry instance:

1. Go to **Settings > Developer Settings > New Internal Integration** or create an OAuth app at `https://your-sentry/settings/account/api/applications/`
2. Set the **Redirect URI**: `http://localhost:3000/oauth/callback` (adjust for production)
3. Required **Scopes**: `org:read`, `project:read`, `project:write`, `team:read`, `team:write`, `event:write`
4. Save the **Client ID** and **Client Secret**

### 3. Configure Environment

```bash
cd fastmcp-http-oauth

# Copy example environment file
cp .env.example .env

# Generate security keys
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "JWT_SIGNING_KEY=$(openssl rand -base64 32)" >> .env

# Edit with your Sentry OAuth credentials
nano .env
```

### 4. Start the Server

```bash
docker compose up -d
```

The server will be available at:
- **MCP Endpoint**: `http://localhost:3000/mcp`
- **Health Check**: `http://localhost:3000/health`
- **OAuth Discovery**: `http://localhost:3000/.well-known/oauth-authorization-server`

### 5. View Logs

```bash
docker compose logs -f sentry-mcp
```

## Client Configuration

Any MCP client that supports HTTP Streamable transport and OAuth 2.1 can connect. Configure your client with:

```json
{
  "mcpServers": {
    "sentry": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "oauth": {
        "discoveryUrl": "http://localhost:3000/.well-known/oauth-authorization-server"
      }
    }
  }
}
```

For production, replace `localhost:3000` with your server's public URL (e.g., `https://mcp.example.com`).

## Configuration Reference

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `BASE_URL` | Public URL of this server (e.g., `https://mcp.example.com`) |
| `SENTRY_HOST` | Sentry instance hostname (e.g., `sentry.io` or `sentry.example.com`) |
| `SENTRY_CLIENT_ID` | OAuth application Client ID |
| `SENTRY_CLIENT_SECRET` | OAuth application Client Secret |
| `ENCRYPTION_KEY` | Token encryption key (32+ chars, generate with `openssl rand -base64 32`) |
| `JWT_SIGNING_KEY` | JWT signing key (32+ chars, generate with `openssl rand -base64 32`) |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `REDIS_URL` | Redis/Valkey connection URL | `redis://localhost:6379` |
| `REDIS_TLS` | Enable TLS for Redis | Auto-detected from URL |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | Verify TLS certificates | `true` |
| `SENTRY_SCOPES` | OAuth scopes (comma-separated) | `org:read,project:read,...` |
| `LOG_LEVEL` | Set to `debug` for verbose logging | Not set |
| `ALLOWED_REDIRECT_URI_PATTERNS` | OAuth redirect URI patterns (comma-separated) | `*` (allow all) |

### AI-Powered Tools (Optional)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for AI-powered tools |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible endpoint |
| `MCP_URL` | URL for docs search API (default: `https://mcp.sentry.dev`) |

Without `OPENAI_API_KEY`, the following tools are disabled:
- `search_events` - Natural language search for errors/logs/spans
- `search_issues` - Natural language issue search
- `search_issue_events` - Search events within issues
- `use_sentry` - General natural language interface

## Available Tools

All 21 tools from `@sentry/mcp-core` are available:

**Core Tools** (always available):
`whoami`, `find_organizations`, `find_teams`, `find_projects`, `find_releases`, `find_dsns`, `get_issue_details`, `get_trace_details`, `get_event_attachment`, `update_issue`, `create_team`, `create_project`, `update_project`, `create_dsn`

**AI-Powered Tools** (require `OPENAI_API_KEY`):
`search_events`, `search_issues`, `search_issue_events`, `use_sentry`

**Documentation Tools**:
`search_docs`, `get_doc`, `analyze_issue_with_seer`

## Production Deployment

### Security Checklist

- [ ] Use HTTPS for `BASE_URL`
- [ ] Generate strong keys with `openssl rand -base64 32`
- [ ] Configure `ALLOWED_REDIRECT_URI_PATTERNS` to restrict OAuth callbacks to known clients
- [ ] Configure Redis authentication
- [ ] Enable TLS for Redis connections in production
- [ ] Use proper network isolation
- [ ] Configure rate limiting (nginx/traefik)

### Redis/Valkey TLS

For encrypted connections:

```bash
# Use rediss:// protocol (double 's')
REDIS_URL=rediss://valkey.example.com:6379
REDIS_TLS=true
```

### Horizontal Scaling

The server is fully stateless:

1. Run multiple instances behind a load balancer
2. All instances share the same Redis/Valkey cluster
3. Any instance can handle any request

### Health Checks

- **HTTP**: `GET /health` returns `ok` with status 200
- **Kubernetes**: Use as liveness/readiness probe

## Troubleshooting

### OAuth Errors

| Error | Solution |
|-------|----------|
| "Invalid redirect_uri" | Ensure callback URL matches Sentry OAuth app config |
| "Token expired" | Check Redis connection and TTL settings |
| "Invalid token" | Verify `JWT_SIGNING_KEY` matches between instances |

### Redis Connection Issues

```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping
```

### Debug Logging

Enable verbose logging:

```bash
LOG_LEVEL=debug docker compose up
```

## Development

### Run Locally (without Docker)

```bash
# Install dependencies
pnpm install

# Start Valkey
docker run -d -p 6379:6379 valkey/valkey:8-alpine

# Run server in development mode
pnpm dev
```

### Build from Monorepo

This server depends on `@sentry/mcp-core`. When building from the monorepo:

```bash
# From repository root
pnpm install
pnpm -w run build  # Build mcp-core first

# Then build/run this server
cd fastmcp-http-oauth
docker compose build
```

## License

Same as parent Sentry MCP project.
