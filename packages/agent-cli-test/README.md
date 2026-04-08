# Agent CLI Test

`@sentry/mcp-agent-cli-test` runs real smoke tests through local agent CLIs such as Claude Code and Codex.

It is intended for QA of the actual client integration, not just raw MCP connectivity.

## What It Tests

For each provider, the harness:

1. Checks that the named MCP server is configured in the local CLI
2. Runs a real prompt through the agent CLI
3. Verifies that the final answer contains the authenticated email from `whoami`

The default scenario uses the repo's HTTP MCP config with the server named `sentry-dev`.

## Requirements

- The target CLI must already be installed and authenticated
- For `--setup repo`, the repo's local MCP config must be valid
- For `--setup repo`, the local dev server should be running at `http://localhost:5173`
- For `--setup stdio`, `packages/mcp-server/dist/index.js` must be built

This package deliberately uses the user's real local agent session instead of injecting repo-specific credentials.

## Usage

From the repository root:

```bash
pnpm -w run agent-cli-test --provider claude --setup repo
pnpm -w run agent-cli-test --provider codex --setup repo

pnpm -w run agent-cli-test --provider claude --setup stdio
pnpm -w run agent-cli-test --provider codex --setup stdio
```

### Options

- `--provider <claude|codex>`: which agent CLI to test
- `--setup <repo|stdio>`: which checked-in MCP project setup to use, default `repo`
- `--server <name>`: configured MCP server name to target, defaults to `sentry-dev` for `repo` and `sentry-stdio` for `stdio`
- `--scenario <whoami>`: smoke test scenario, default `whoami`
- `--cwd <path>`: working directory to use when resolving local config, default is the original invoking directory
- `--skip-health-check`: skip the provider-specific MCP config/status check
- `--timeout-ms <ms>`: command timeout, default `120000`
- `--json`: emit structured JSON instead of text

## Examples

Run against the production hosted server if your local CLI has it configured:

```bash
pnpm -w run agent-cli-test --provider claude --setup repo --server sentry
```

Get machine-readable output:

```bash
pnpm -w run agent-cli-test --provider codex --setup stdio --json
```

## Stdio Auth Caveat

The checked-in `stdio` setup lives in `projects/stdio/` and uses an isolated auth cache at `projects/stdio/.sentry/mcp.json`.

Real clients do not give the stdio subprocess a TTY, so they cannot start the device-code flow themselves on first run. With an empty cache, the subprocess exits and asks you to run auth interactively first.

Claude also needs non-interactive MCP tool permissions enabled in `-p` mode. The harness passes `--permission-mode bypassPermissions` for Claude automatically.

Warm the cache from a real TTY before rerunning the client harness:

```bash
SENTRY_MCP_AUTH_CACHE="$PWD/packages/agent-cli-test/projects/stdio/.sentry/mcp.json" \
node packages/mcp-server/dist/index.js auth login
```

After that succeeds, rerun:

```bash
pnpm -w run agent-cli-test --provider claude --setup stdio
pnpm -w run agent-cli-test --provider codex --setup stdio
```
