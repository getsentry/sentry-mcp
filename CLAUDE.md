# CLAUDE.md

## 🔴 CRITICAL Requirements

**MANDATORY before ANY code:**
1. TypeScript: NEVER use `any`. Use `unknown` or proper types
2. Security: NO API keys in logs. NO vulnerabilities
3. Validation: `pnpm run tsc && pnpm run lint && pnpm run test`
4. Tools limit: ≤20 (hard limit: 25)

**MANDATORY reads:**
- Tools → `docs/adding-tools.mdc`
- Prompts → `docs/adding-prompts.mdc`
- Resources → `docs/adding-resources.mdc`
- Testing → `docs/testing.mdc`
- PRs → `docs/pr-management.mdc`

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
│   ├── mcp-server/          # Main MCP server
│   │   ├── src/
│   │   │   ├── tools/       # 19 tool modules
│   │   │   ├── prompts.ts   # MCP prompts
│   │   │   ├── resources.ts # MCP resources
│   │   │   ├── server.ts    # MCP protocol
│   │   │   ├── api-client/  # Sentry API
│   │   │   └── internal/    # Shared utils
│   │   └── scripts/         # Build scripts
│   ├── mcp-cloudflare/      # Web app
│   ├── mcp-server-evals/    # AI tests
│   ├── mcp-server-mocks/    # MSW mocks
│   └── mcp-test-client/     # Test client
└── docs/                    # All docs
```

## AI-Powered Search Tools

**search_events** (`packages/mcp-server/src/tools/search-events/`):
- Natural language → DiscoverQL queries
- GPT-4o agent with structured outputs
- Tools: `datasetAttributes`, `otelSemantics`, `whoami`
- Requires: `OPENAI_API_KEY`

**search_issues** (`packages/mcp-server/src/tools/search-issues/`):
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

# Quality checks (combine for speed)
pnpm run tsc && pnpm run lint && pnpm run test

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
- `docs/adding-tools.mdc` - Tool development
- `docs/adding-prompts.mdc` - Prompt development
- `docs/adding-resources.mdc` - Resource development
- `docs/testing.mdc` - Testing requirements
- `docs/common-patterns.mdc` - Code patterns
- `docs/api-patterns.mdc` - API usage
- `docs/architecture.mdc` - System design
- `docs/quality-checks.mdc` - Quality checks
- `docs/pr-management.mdc` - PR guidelines

## Rules

1. **Code**: Follow existing patterns. Check adjacent files
2. **Errors**: Try/catch all async. Log: `console.error('[ERROR]', error.message, error.stack)`
   - Sentry API 429: Retry with exponential backoff
   - Sentry API 401/403: Check token permissions
3. **Docs**: Update when changing functionality
4. **PR**: Read `docs/pr-management.mdc`. Include Claude Code attribution
5. **Tasks**: Use TodoWrite for 3+ steps. Batch tool calls when possible

---
*Optimized for Claude Code (Sonnet 4/Opus 4)*