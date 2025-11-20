# CLAUDE.md

## 🔴 CRITICAL Requirements

**MANDATORY before ANY code:**
1. TypeScript: NEVER use `any`. Use `unknown` or proper types
2. Security: NO API keys in logs. NO vulnerabilities
3. Validation: `pnpm run tsc && pnpm run lint && pnpm run test`
4. Tools limit: ≤20 (hard limit: 25)

**MANDATORY reads:**
- Start here: CLAUDE.md — Contributor doc map
- Tools → @docs/adding-tools.mdc
- Testing → @docs/testing.mdc
- PRs → @docs/pr-management.mdc

## 🟡 MANDATORY Workflow

```bash
# BEFORE coding (parallel execution)
cat docs/[component].mdc & ls -la neighboring-files & git status

# AFTER coding (sequential - fail fast)
pnpm run tsc && pnpm run lint && pnpm run test  # ALL must pass
```

## Repository Map

```
sentry-mcp/
├── packages/
│   ├── mcp-core/            # Core MCP implementation (private package)
│   │   ├── src/
│   │   │   ├── tools/       # 19 tool modules
│   │   │   ├── server.ts    # buildServer() function
│   │   │   ├── api-client/  # Sentry API
│   │   │   └── internal/    # Shared utils
│   │   └── scripts/         # Build scripts
│   ├── mcp-server/          # stdio transport (published as @sentry/mcp-server)
│   │   └── src/
│   │       ├── cli/         # CLI argument parsing
│   │       ├── transports/  # stdio transport
│   │       └── index.ts     # Main entry point
│   ├── mcp-cloudflare/      # Web app
│   ├── mcp-server-evals/    # AI tests
│   ├── mcp-server-mocks/    # MSW mocks
│   └── mcp-test-client/     # Test client
└── docs/                    # All docs
```

## AI-Powered Search Tools

**search_events** (`packages/mcp-core/src/tools/search-events/`):
- Natural language → DiscoverQL queries
- GPT-4o agent with structured outputs
- Tools: `datasetAttributes`, `otelSemantics`, `whoami`
- Requires: `OPENAI_API_KEY`

**search_issues** (`packages/mcp-core/src/tools/search-issues/`):
- Natural language → issue search syntax
- GPT-4o agent with structured outputs
- Tools: `issueFields`, `whoami`
- Requires: `OPENAI_API_KEY`

## 🟢 Key Commands

```bash
# Development
pnpm run dev               # Start development
pnpm run build             # Build all packages
pnpm run generate-otel-namespaces  # Update OpenTelemetry docs

# Manual Testing (preferred for testing MCP changes)
pnpm -w run cli "who am I?"                    # Test with local dev server (default)
pnpm -w run cli --agent "who am I?"            # Test agent mode (use_sentry tool) - approximately 2x slower
pnpm -w run cli --mcp-host=https://mcp.sentry.dev "query"  # Test against production
pnpm -w run cli --access-token=TOKEN "query"   # Test with local stdio mode

# Quality checks (combine for speed)
pnpm run tsc && pnpm run lint && pnpm run test

# Token cost monitoring
pnpm run measure-tokens  # Check tool definition overhead

# Common workflows
pnpm run build && pnpm run test  # Before PR
grep -r "TODO\|FIXME" src/     # Find tech debt
```

## Quick Reference

**Defaults:**
- Organization: `sentry`
- Project: `mcp-server`
- Transport: stdio
- Auth: access tokens (NOT OAuth)

**Doc Index:**

- Core Guidelines
  - @docs/coding-guidelines.mdc — Code standards and patterns
  - @docs/common-patterns.mdc — Reusable patterns and conventions
  - @docs/quality-checks.mdc — Required checks before changes
  - @docs/error-handling.mdc — Error handling patterns

- API and Tools
  - @docs/adding-tools.mdc — Add new MCP tools
  - @docs/api-patterns.mdc — Sentry API usage
  - @docs/search-events-api-patterns.md — search_events specifics

- Infrastructure and Operations
  - @docs/architecture.mdc — System design
  - @docs/releases/cloudflare.mdc — Cloudflare Workers release
  - @docs/releases/stdio.mdc — npm package release
  - @docs/monitoring.mdc — Monitoring/telemetry
  - @docs/security.mdc — Security and authentication
  - @docs/token-cost-tracking.mdc — Track MCP tool definition overhead
  - @docs/cursor.mdc — Cursor IDE integration

- Testing
  - @docs/testing.mdc — Testing strategies and patterns
  - @docs/testing-stdio.md — Stdio testing playbook (build, run, test)
  - @docs/testing-remote.md — Remote testing playbook (OAuth, web UI, CLI)

- LLM-Specific
  - @docs/llms/documentation-style-guide.mdc — How to write LLM docs
  - @docs/llms/document-scopes.mdc — Doc scopes and purposes

## Rules

1. **Code**: Follow existing patterns. Check adjacent files
2. **Errors**: Try/catch all async. Log: `console.error('[ERROR]', error.message, error.stack)`
   - Sentry API 429: Retry with exponential backoff
   - Sentry API 401/403: Check token permissions
3. **Docs**: Update when changing functionality
4. **PR**: Follow `docs/pr-management.mdc` for commit/PR guidelines (includes AI attribution)
5. **Tasks**: Use TodoWrite for 3+ steps. Batch tool calls when possible

---
*Optimized for Codex CLI (OpenAI) and Claude Code*
