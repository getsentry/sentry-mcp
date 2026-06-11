# AGENTS.md
Sentry MCP is a Model Context Protocol server that exposes Sentry's error tracking and performance monitoring to AI assistants through 19 tools.

## Principles

- **Type Safety**: Prefer strict types over `any` - they catch bugs and improve tooling. Use `unknown` for truly unknown types.
- **Security**: Never log secrets. Validate external input. See docs/operations/security.md.
- **Simplicity**: Follow existing patterns. Check neighboring files before inventing new approaches.

## Constraints

- **Tool count**: Target ≤20, hard limit 25 (AI agents have limited tool slots).
- **Quality gate**: `pnpm run tsc && pnpm run lint && pnpm run test` must pass before committing.

## Repository Structure

```
sentry-mcp/
├── packages/
│   ├── mcp-core/            # Core MCP implementation (private)
│   │   └── src/
│   │       ├── tools/       # 19 tool modules
│   │       ├── server.ts    # buildServer()
│   │       ├── api-client/  # Sentry API
│   │       └── internal/    # Shared utils
│   ├── mcp-server/          # stdio transport (@sentry/mcp-server on npm)
│   ├── mcp-cloudflare/      # Web app + OAuth
│   ├── mcp-server-evals/    # AI evaluation tests
│   ├── mcp-server-mocks/    # MSW mocks
│   └── mcp-test-client/     # CLI test client
└── docs/                    # All documentation
```

## Documentation Map

- docs/README.md — Full documentation index

**Read before tool changes:**
- docs/contributing/adding-tools.md — Tool implementation guide
- docs/contributing/tool-responses.md — Tool output policy and QA review checklist
- docs/testing/overview.md — Testing requirements and snapshot policy
- docs/contributing/common-patterns.md — Error handling, Zod schemas, shared formatting patterns
- docs/contributing/error-handling.md — Error types and propagation

**Contributing:**
- docs/contributing/api-patterns.md — Sentry API client usage
- docs/contributing/coding-guidelines.md — TypeScript and code style guidance
- docs/contributing/documentation-style-guide.md — Documentation style guide
- docs/contributing/pr-management.md — Commit and PR guidelines
- docs/contributing/quality-checks.md — Pre-commit checklist
- docs/contributing/search-events-api-patterns.md — Search Events API patterns

**Testing:**
- docs/testing/overview.md — Unit, snapshot, eval, and agent CLI testing
- docs/testing/stdio.md — Stdio transport testing
- docs/testing/remote.md — Remote server and OAuth testing

**Architecture and Operations:**
- docs/architecture/overview.md — System design
- docs/operations/security.md — Authentication and security patterns
- docs/operations/stdio-auth.md — Device code flow, token caching, client ID architecture
- docs/operations/oauth-signout-playbook.md — Remote OAuth diagnostic runbook
- docs/operations/embedded-agents.md — LLM provider configuration for AI-powered tools
- docs/operations/github-actions.md — GitHub Actions guidance
- docs/operations/logging.md — Logging guidance
- docs/operations/monitoring.md — Monitoring guidance
- docs/operations/token-cost-tracking.md — Tool definition token cost tracking

**Cloudflare:**
- docs/cloudflare/overview.md — Cloudflare package overview
- docs/cloudflare/architecture.md — Cloudflare architecture
- docs/cloudflare/oauth-architecture.md — Cloudflare OAuth architecture

**Integrations:**
- docs/integrations/claude-code-plugin.md — Plugin structure and agent prompts
- docs/integrations/flue-hooks.md — Flue hook notes
- docs/integrations/ide-instructions-refactor.md — IDE instruction refactor notes

**Specs:**
- docs/specs/README.md — Specs index
- docs/specs/embedded-agent-openai-routing.md — Embedded agent OpenAI routing spec
- docs/specs/search-events.md — Search Events spec
- docs/specs/subpath-constraints.md — Subpath constraints spec

**Releases:**
- docs/releases/stdio.md — npm package release
- docs/releases/cloudflare.md — Cloudflare deployment

## Commands

```bash
# Development
pnpm run dev                              # Start dev server
pnpm run build                            # Build all packages

# Testing
pnpm -w run cli --transport stdio "q"      # Test MCP tools
pnpm -w run cli --transport stdio --access-token=TOKEN "q"
pnpm -w run cli --transport stdio --agent "query"

# Quality (run before committing)
pnpm run tsc && pnpm run lint && pnpm run test

# Token overhead
pnpm run measure-tokens                   # Check tool definition size

# Definitions (run after changing tools, skills, or agent prompts)
pnpm run --filter @sentry/mcp-core generate-definitions
```

## QA Playbook

For MCP tool QA, follow `.agents/skills/qa/SKILL.md`: stdio-first local CLI and
real agent clients; Cloudflare HTTP or `/mcp` only for transport, OAuth,
routing, or hosted-server compatibility.

## Task Management

Use `/dex` skill to coordinate complex work. Create tasks with full context, break down into subtasks, complete with detailed results.

## Workflow

1. Check neighboring files for existing patterns before writing new code.
2. When adding or modifying Sentry API endpoint usage, ALWAYS validate the endpoint behavior against the Sentry source code in `~/src/sentry` instead of assuming docs or client parameters are authoritative.
3. Update relevant docs when changing functionality.
4. Follow docs/contributing/error-handling.md for error types.
5. Follow docs/contributing/pr-management.md for commits and PRs.

## Commit Attribution

AI commits MUST include:
```
Co-Authored-By: (the agent model's name and attribution byline)
```
