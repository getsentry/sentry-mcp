---
name: qa
description: QA test changes against the local dev server. Use when explicitly invoked via /qa to verify changes work end-to-end.
---

# QA Testing

Verify changes work end-to-end before committing or creating a PR.

## Step 1: Run Quality Gate

```bash
pnpm run tsc && pnpm run lint && pnpm run test
```

Fix any failures before proceeding.

## Step 2: Test with CLI Client (Agent)

This is the primary QA method. It uses an AI agent to exercise MCP tools against the local dev server.

### Start the dev server

Run `pnpm dev` in the background. It starts at `http://localhost:5173`. Verify it's up:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
```

If it returns a non-200 or fails to connect, the server isn't running yet — wait and retry.

### Run test queries

The CLI connects to the local dev server via HTTP by default (no flags needed):

```bash
# Verify auth and connectivity
pnpm -w run cli "who am I?"

# Verify tools are available (count varies by granted skills)
pnpm -w run cli "list all available tools"

# Test a specific tool relevant to your changes
pnpm -w run cli "find my organizations"
```

Look for `Connected to MCP server (remote)` in output to confirm HTTP transport to the dev server.

### Agent mode (optional)

Tests the `use_sentry` meta-tool instead of individual tools. ~2x slower:

```bash
pnpm -w run cli --agent "show me my recent errors"
```

### Experimental tools

If your changes involve experimental tools:

```bash
pnpm -w run cli --experimental "your query"
```

## Step 3: Human-Only Testing (Reference)

These methods require human interaction and cannot be run by the agent. Suggest them to the user when relevant.

### MCP Inspector

Interactive web UI for testing individual tools with specific parameters:

```bash
pnpm inspector          # HTTP transport, opens http://localhost:6274
pnpm inspector:stdio    # Stdio transport, direct connection
```

### Web UI with OAuth

Full browser-based testing with OAuth authentication:

1. Start dev server: `pnpm dev`
2. Open `http://localhost:5173`
3. Authenticate via OAuth flow
4. Test via chat interface

Constraint testing via URL paths:
- `http://localhost:5173/mcp/org-slug` — org-scoped
- `http://localhost:5173/mcp/org-slug/project-slug` — project-scoped

## Stdio / Production Build Testing (Rare)

Almost never needed — use the dev server approach above. Only use this when specifically testing the npm package build:

```bash
# Build first
pnpm -w run build

# Test via stdio transport (requires a Sentry access token)
pnpm -w run cli --access-token=TOKEN "who am I?"
```

Look for `Connected to MCP server (stdio)` to confirm stdio transport.
