# Testing the Remote MCP Server

Complete playbook for building, deploying, and testing the remote MCP server via HTTP transport.

## Overview

The remote MCP server runs on Cloudflare Workers and provides HTTP-based access to the MCP protocol. Clients connect via HTTP/SSE instead of stdio pipes.

**When to use remote:**
- Testing OAuth flows
- Testing constraint-based access control (org/project filtering)
- Testing the web chat interface
- Production-like environment testing
- Multi-user scenarios

**When to use stdio instead:**
- Self-hosted Sentry without OAuth
- IDE integration testing
- Direct API token authentication
- Local development without network

## Prerequisites

- Node.js 20+
- pnpm installed
- Wrangler CLI (for Cloudflare deployment)
- Sentry OAuth application credentials

## Setup

### 1. Clone and Install

```bash
cd sentry-mcp
pnpm install
```

### 2. Create Environment Files

```bash
# Creates .env files from examples
make setup-env
```

### 3. Configure Sentry OAuth App

**Create an OAuth App in Sentry:**

1. Go to Settings → API → [Applications](https://sentry.io/settings/account/api/applications/)
2. Click "Create New Application"
3. Configure:
   - **Name:** "Sentry MCP Development" (or similar)
   - **Homepage URL:** `http://localhost:5173`
   - **Authorized Redirect URIs:** `http://localhost:5173/oauth/callback`
4. Save and note your **Client ID** and **Client Secret**

### 4. Configure Environment Variables

**Edit `packages/mcp-cloudflare/.env`:**
```bash
SENTRY_CLIENT_ID=your_development_client_id
SENTRY_CLIENT_SECRET=your_development_client_secret
COOKIE_SECRET=generate-a-random-32-char-string

# Optional: For AI-powered search tools
OPENAI_API_KEY=your-openai-key
```

**Edit `.env` (root):**
```bash
# For testing CLI client and search tools
OPENAI_API_KEY=your-openai-key
```

**Generate COOKIE_SECRET:**
```bash
# Using OpenSSL
openssl rand -base64 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Running the Remote Server

### Option 1: Local Development Server

**Start the dev server:**
```bash
# From repo root
pnpm dev

# Or from cloudflare package
cd packages/mcp-cloudflare
pnpm dev
```

Server runs at: `http://localhost:5173`

**What this does:**
- Starts Cloudflare Workers local dev environment
- Enables hot reload for code changes
- Uses local KV storage (not persisted)
- Serves the web UI at root
- MCP endpoint at `/mcp`

### Option 2: Deploy to Cloudflare

**Deploy to your Cloudflare account:**
```bash
cd packages/mcp-cloudflare
pnpm deploy
```

**Deploy to production (requires permissions):**
```bash
# Automated via GitHub Actions on push to main
# Manual deployment:
pnpm deploy --env production
```

## Testing with the CLI Client

The CLI client (`mcp-test-client`) provides a command-line interface for testing the remote server.

### Basic Usage

**Test against local dev server (default):**
```bash
# Single query
pnpm -w run cli "who am I?"

# Interactive mode
pnpm -w run cli
> who am I?
> find my organizations
> exit
```

**Test against production:**
```bash
pnpm -w run cli --mcp-host=https://mcp.sentry.dev "who am I?"
```

**Test with specific MCP URL:**
```bash
# Custom deployment
pnpm -w run cli --mcp-host=https://your-worker.workers.dev "query"

# Set via environment variable
export MCP_URL=https://mcp.sentry.dev
pnpm -w run cli "query"
```

### Testing Agent Mode

Agent mode uses only the `use_sentry` tool (natural language interface):

```bash
# Test agent mode locally
pnpm -w run cli --agent "show me my recent errors"

# Test agent mode in production
pnpm -w run cli --mcp-host=https://mcp.sentry.dev --agent "what projects do I have?"
```

**Agent mode is ~2x slower** because it requires an additional AI call to translate natural language to tool calls.

### OAuth Flow Testing

**First run triggers OAuth:**
```bash
pnpm -w run cli "who am I?"
```

**Flow:**
1. CLI opens browser to `http://localhost:5173/oauth/authorize`
2. You're redirected to Sentry OAuth
3. Approve access and grant permissions
4. Redirected back with tokens
5. CLI receives tokens and executes query

**Subsequent runs use cached tokens:**
- Tokens stored in `~/.sentry-mcp-tokens.json`
- Automatically refreshed when expired
- To force re-auth: delete the token file

### Testing with Constraints

Constraints limit access to specific organizations/projects:

**Organization constraint:**
```bash
# Access limited to "sentry" org
pnpm -w run cli --mcp-host=http://localhost:5173/mcp/sentry "list my projects"
```

**Organization + Project constraint:**
```bash
# Access limited to "sentry/javascript"
pnpm -w run cli \
  --mcp-host=http://localhost:5173/mcp/sentry/javascript \
  "show me recent errors"
```

**Verify constraints work:**
```bash
# Should only return projects in "sentry" org
pnpm -w run cli --mcp-host=http://localhost:5173/mcp/sentry "find_projects()"

# Should return error if trying to access different org
pnpm -w run cli --mcp-host=http://localhost:5173/mcp/sentry "find_projects(organizationSlug='other-org')"
```

## Testing with Web Chat Interface

The web UI provides a chat interface for testing the MCP server.

### Access the Interface

**Local development:**
1. Start dev server: `pnpm dev`
2. Open browser: `http://localhost:5173`
3. Follow OAuth flow to authenticate

**Production:**
1. Navigate to `https://mcp.sentry.dev`
2. Follow OAuth flow

### Testing Workflow

**1. Authentication:**
- Click "Connect to Sentry"
- Authorize the application
- Grant permissions (select skills)

**2. Basic Queries:**
- "Who am I?" - Test authentication
- "Show my organizations" - Test data access
- "List projects in [org-name]" - Test specific queries

**3. Complex Operations:**
- "Find unresolved errors in [project]"
- "Show me performance issues from yesterday"
- "Search for 'database timeout' errors"

**4. Test Constraints:**
Navigate to constrained URL:
- `http://localhost:5173/mcp/your-org` - Org constraint
- `http://localhost:5173/mcp/your-org/your-project` - Org + project constraint

Verify queries are limited to that scope.

### Chat Interface Features

**Available in chat:**
- Natural language queries
- Tool call visualization
- Streaming responses
- Error display
- Token refresh handling

**Not available (use CLI for these):**
- Direct tool calls with parameters
- Agent mode toggle
- Multiple simultaneous queries

## Testing with MCP Inspector

The MCP Inspector can test remote servers via HTTP transport.

### Setup Inspector

```bash
# From repo root
pnpm inspector
```

Opens at `http://localhost:6274`

### Connect to Remote Server

**1. Add Server:**
- Click "Add Server"
- Select "SSE" or "HTTP" transport
- Enter URL: `http://localhost:5173/mcp`

**2. Authenticate:**
- Click "Connect"
- Browser opens for OAuth flow
- Approve access
- Redirected back to Inspector

**3. Test Tools:**
- Click "List Tools" - Verify tools appear
- Test individual tools with parameters
- View responses and errors

### Inspector Testing Patterns

**Basic verification:**
1. List tools → Verify expected tools available
2. Call `whoami` → Verify authentication
3. Call `find_organizations` → Verify data access

**Parameter testing:**
```json
// Test find_projects with parameters
{
  "organizationSlug": "your-org",
  "query": "bookmarks:true"
}
```

**Error testing:**
```json
// Invalid org should error gracefully
{
  "organizationSlug": "nonexistent-org"
}
```

**Complex tool testing:**
```json
// Test search_events with AI
{
  "organizationSlug": "your-org",
  "naturalLanguageQuery": "errors in the last hour",
  "dataset": "errors"
}
```

## Common Testing Workflows

### 1. End-to-End OAuth Flow

```bash
# Clean slate
rm ~/.sentry-mcp-tokens.json

# Test fresh OAuth
pnpm -w run cli "who am I?"

# Verify tokens cached
ls -la ~/.sentry-mcp-tokens.json

# Test cached tokens work
pnpm -w run cli "list organizations"
```

### 2. Test Skills Permissions

**In OAuth approval screen, test:**
- Minimal skills (inspect, docs only)
- Default skills (inspect, seer, docs)
- All skills (inspect, seer, docs, triage, project-management)

**Verify tools filtered by skills:**
```bash
# With inspect, docs only: no write tools
pnpm -w run cli "list tools" | grep "create_"

# With all skills: includes write tools
# Should see: create_project, create_team, update_issue, etc.
```

### 3. Test Multi-Organization Access

```bash
# User with multiple orgs
pnpm -w run cli "find_organizations()"

# Should list all accessible orgs
# Test switching between orgs in chat interface
```

### 4. Test Constraints

```bash
# No constraint - full access
pnpm -w run cli --mcp-host=http://localhost:5173/mcp \
  "find_organizations()"

# Org constraint - limited access
pnpm -w run cli --mcp-host=http://localhost:5173/mcp/sentry \
  "find_organizations()"
  # Should only return "sentry" org

# Project constraint - most limited
pnpm -w run cli --mcp-host=http://localhost:5173/mcp/sentry/javascript \
  "find_projects()"
  # Should only return "javascript" project
```

### 5. Test After Code Changes

```bash
# 1. Build changes
pnpm -w run build

# 2. Restart dev server
pnpm dev

# 3. Test with CLI
pnpm -w run cli "who am I?"

# 4. Test in web UI
# Open http://localhost:5173 and test manually

# 5. Run integration tests
cd packages/mcp-cloudflare
pnpm test
```

### 6. Test Token Refresh

```bash
# Get initial tokens
pnpm -w run cli "who am I?"

# Simulate token expiry (edit token file)
# Set expires_at to past timestamp in ~/.sentry-mcp-tokens.json

# Next request should refresh automatically
pnpm -w run cli "who am I?"

# Verify new token in file
cat ~/.sentry-mcp-tokens.json | jq .expires_at
```

## Troubleshooting

### "Failed to connect to MCP server"

**Causes:**
1. Dev server not running
2. Wrong URL
3. Network issues

**Solution:**
```bash
# Verify dev server is running
curl http://localhost:5173/

# Check MCP endpoint
curl http://localhost:5173/mcp

# Restart dev server
pnpm dev
```

### "OAuth authorization failed"

**Causes:**
1. Invalid client ID/secret
2. Redirect URI mismatch
3. Expired OAuth app

**Solution:**
```bash
# Verify credentials in .env
cat packages/mcp-cloudflare/.env | grep SENTRY_CLIENT

# Check OAuth app settings in Sentry
# Redirect URI must match exactly: http://localhost:5173/oauth/callback

# Try with fresh credentials
# Delete and recreate OAuth app in Sentry
```

### "Permission denied" errors

**Cause:** Insufficient skills granted during OAuth.

**Solution:**
```bash
# Force re-authorization with more skills
rm ~/.sentry-mcp-tokens.json
pnpm -w run cli "who am I?"

# In OAuth approval screen, select all needed skills
```

### "Tool not found" errors

**Causes:**
1. Tool filtered by skills
2. Build issue
3. Server version mismatch

**Solution:**
```bash
# Check tool list
pnpm -w run cli "list tools" | jq '.tools[] | .name'

# Verify skills include required permissions
# Example: create_project requires project-management skill

# Rebuild and restart
pnpm -w run build && pnpm dev
```

### "Invalid constraint" errors

**Cause:** Trying to access resources outside constrained scope.

**Solution:**
```bash
# Verify constraint in URL
echo "Accessing: http://localhost:5173/mcp/org-slug/project-slug"

# Verify you have access to that org/project
pnpm -w run cli --mcp-host=http://localhost:5173/mcp \
  "find_organizations()"
```

### Web UI not loading

**Causes:**
1. Build failed
2. Assets not compiled
3. Wrangler issue

**Solution:**
```bash
# Rebuild assets
cd packages/mcp-cloudflare
pnpm build

# Clear Wrangler cache
rm -rf .wrangler

# Restart dev server
pnpm dev

# Check browser console for errors
```

### "Rate limited" errors

**Cause:** Too many requests to Sentry API.

**Solution:**
```bash
# Wait for rate limit to reset (usually 60 seconds)

# Use fewer requests in testing
# Example: Don't query all projects repeatedly

# For testing, use mocked responses instead
cd packages/mcp-server
pnpm test
```

## Quality Checks

Before deploying changes:

```bash
# 1. Build successfully
pnpm -w run build

# 2. Type check
pnpm -w run tsc

# 3. Lint
pnpm -w run lint

# 4. Run tests
pnpm -w run test

# 5. Test OAuth flow locally
rm ~/.sentry-mcp-tokens.json
pnpm -w run cli "who am I?"

# 6. Test web UI locally
# Open http://localhost:5173 and verify:
# - Authentication works
# - Chat interface works
# - Tool calls execute correctly

# 7. Test with Inspector
pnpm inspector
# Connect to http://localhost:5173/mcp
# Verify tools list and basic operations
```

## Deployment Checklist

### Before Production Deploy

- [ ] All tests pass
- [ ] OAuth flow tested locally
- [ ] Web UI tested locally
- [ ] CLI client tested against local server
- [ ] Constraints tested (org and project level)
- [ ] Error handling verified
- [ ] Token refresh tested

### Production Deploy

```bash
# Via GitHub Actions (automatic)
git push origin main

# Manual (if needed)
cd packages/mcp-cloudflare
pnpm deploy --env production
```

### After Deploy

- [ ] Test OAuth against production
- [ ] Test web UI at https://mcp.sentry.dev
- [ ] Test CLI: `pnpm -w run cli --mcp-host=https://mcp.sentry.dev "who am I?"`
- [ ] Test MCP Inspector against production
- [ ] Verify no errors in Cloudflare dashboard
- [ ] Check Sentry for any errors

## Comparing with Stdio

Key differences to verify:

| Feature | Stdio | Remote |
|---------|-------|--------|
| Authentication | Access token | OAuth |
| Constraints | Via CLI flags | Via URL path |
| Transport | stdin/stdout | HTTP/SSE |
| Multi-user | No | Yes |
| Token refresh | N/A | Automatic |
| Web UI | No | Yes |
| Performance | Faster (no network) | Network latency |

**Test both work identically:**
```bash
# Stdio
pnpm start --access-token=TOKEN
# (Use MCP Inspector with stdio config)

# Remote
pnpm -w run cli "who am I?"

# Both should:
# - Return same tool list
# - Execute tools with same results
# - Handle errors the same way
```

## Advanced Testing

### Testing Token Encryption

```bash
# Verify tokens are encrypted in KV
# (In Cloudflare dashboard, inspect KV values)
# Should see encrypted blobs, not plaintext tokens
```

### Load Testing

```bash
# Use autocannon for HTTP load testing
npm install -g autocannon

# Test MCP endpoint
autocannon -c 10 -d 30 http://localhost:5173/mcp
```

### Testing Multiple Clients

```bash
# Terminal 1: Client A
pnpm -w run cli "who am I?"

# Terminal 2: Client B (different user)
rm ~/.sentry-mcp-tokens.json
pnpm -w run cli "who am I?"

# Verify both work independently
# Verify constraints apply per-client
```

### Testing Regional Deployments

```bash
# Test with different Sentry regions
pnpm -w run cli --mcp-host=https://us.mcp.sentry.dev "query"
pnpm -w run cli --mcp-host=https://eu.mcp.sentry.dev "query"
```

## Environment-Specific Testing

### Testing Production

```bash
# Use production URL
pnpm -w run cli --mcp-host=https://mcp.sentry.dev "who am I?"

# Test production OAuth app
# (Requires production OAuth credentials)
```

### Testing Staging

```bash
# Use staging deployment
pnpm -w run cli --mcp-host=https://staging.mcp.sentry.dev "who am I?"
```

### Testing Self-Hosted

```bash
# Deploy to self-hosted Cloudflare account
cd packages/mcp-cloudflare
pnpm deploy

# Test with self-hosted URL
pnpm -w run cli --mcp-host=https://your-worker.workers.dev "who am I?"
```

## References

- Remote setup: `docs/cloudflare/deployment.md`
- OAuth architecture: `docs/cloudflare/oauth-architecture.md`
- CLI client: `packages/mcp-test-client/README.md`
- Cloudflare package: `packages/mcp-cloudflare/README.md`
- MCP Inspector: https://modelcontextprotocol.io/docs/tools/inspector
