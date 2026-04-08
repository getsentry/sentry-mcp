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

## Step 3: Test Stdio / Auth Flows When Relevant

Run this step when your changes touch stdio transport, auth, device-code flow, token caching, npm package behavior, or `mcp-test-client`.

### Fast stdio checks

These do not require a browser:

```bash
# Explicit-token stdio path
pnpm -w run cli --transport stdio --access-token=TOKEN --list-tools

# No-token, non-interactive path should fail with the auth guidance
pnpm -w run cli --transport stdio --list-tools
```

Look for `Connected to MCP server (stdio)` in the explicit-token case.
In the no-token non-interactive case, expect the error that instructs you to run `sentry-mcp auth login` interactively first.

### Device-code auth with isolated cache

Use an isolated cache file so QA does not depend on or overwrite `~/.sentry/mcp.json`:

```bash
AUTH_DIR=$(mktemp -d /tmp/sentry-mcp-auth.XXXXXX)
export SENTRY_MCP_AUTH_CACHE="$AUTH_DIR/mcp.json"
pnpm -w run cli --transport stdio --list-tools
```

This must run in a real TTY. The server should print a Sentry device-code URL and wait for authorization.
Complete the browser flow, then confirm the client connects and lists tools.

### Cached-token reuse

After the device-code login succeeds, run the same command again with the same `SENTRY_MCP_AUTH_CACHE`:

```bash
pnpm -w run cli --transport stdio --list-tools
```

Confirm that it reuses the cached token and lists tools without starting another browser-based login.

## Step 4: Test Real Agent CLIs When Relevant

Run this step when validating Claude Code, Codex, or another issue that only reproduces in a real agent client.

The repo includes a harness package that uses the installed local CLI session instead of the `mcp-test-client`:

```bash
# Claude Code against the local dev server MCP entry
pnpm -w run agent-cli-test --provider claude --setup repo

# Codex against the local dev server MCP entry
pnpm -w run agent-cli-test --provider codex --setup repo

# Claude Code against the checked-in stdio MCP entry
pnpm -w run agent-cli-test --provider claude --setup stdio

# Codex against the checked-in stdio MCP entry
pnpm -w run agent-cli-test --provider codex --setup stdio
```

What this verifies:
- The CLI is installed and can see the named MCP server
- The provider can run a real prompt against Sentry MCP
- The final answer includes the authenticated email from `whoami`

Use `--setup repo --server sentry` if you want to test the hosted server instead of the local `sentry-dev` entry.

The checked-in `stdio` setup uses `packages/agent-cli-test/projects/stdio/.sentry/mcp.json` as an isolated auth cache.
Real clients do not give stdio subprocesses a TTY, so the first-run device-code flow must be warmed separately:

```bash
pnpm -w run agent-cli-test auth login
```

If the harness fails, rerun the provider directly with debug enabled so you can see the MCP startup failure:

```bash
# Claude Code: capture a debug log for the real prompt run
claude --mcp-config /tmp/claude-sentry-dev-config.json --strict-mcp-config --permission-mode bypassPermissions --no-session-persistence --debug-file /tmp/claude-sentry-dev.log -p 'Use the "whoami" tool from the MCP server named "sentry-dev". Call it exactly once. Reply with only the authenticated email address.'

# Codex: capture MCP handshake and transport logs
RUST_LOG=codex_core=debug,rmcp=debug RUST_BACKTRACE=1 codex exec --skip-git-repo-check --sandbox read-only --output-last-message /tmp/codex-sentry-dev-last.txt 'Use only the MCP server named "sentry-dev". Call the "whoami" tool exactly once. Reply with only the authenticated email address.'
```

Look for these signatures:
- Claude: `ToolSearchTool`, `mcp__sentry-dev__whoami`, missing server/tool selection, `tool permission denied`
- Codex: `UnexpectedContentType`, `AuthRequired`, `resources/list failed`

## Step 5: Human-Only Testing (Reference)

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

Use this when specifically testing the published/package build rather than the local dev server:

```bash
# Build first
pnpm -w run build

# Test via stdio transport with an explicit token
pnpm -w run cli --transport stdio --access-token=TOKEN "who am I?"
```

Look for `Connected to MCP server (stdio)` to confirm stdio transport.
