# AGENTS.md

Sentry MCP is a Model Context Protocol server that exposes Sentry's error tracking and performance monitoring to AI assistants through 19 tools.

## Principles

- **Type Safety**: Prefer strict types over `any` - they catch bugs and improve tooling. Use `unknown` for truly unknown types.
- **Security**: Never log secrets. Validate external input. See docs/security.md.
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

## Essential Documentation

**Read before making changes:**
- docs/adding-tools.md — Tool implementation guide
- docs/testing.md — Testing requirements
- docs/common-patterns.md — Error handling, Zod schemas, response formatting
- docs/error-handling.md — Error types and propagation

**Reference:**
- docs/architecture.md — System design
- docs/api-patterns.md — Sentry API client usage
- docs/quality-checks.md — Pre-commit checklist
- docs/pr-management.md — Commit/PR guidelines
- docs/security.md — Authentication patterns
- docs/embedded-agents.md — LLM provider configuration for AI-powered tools
- docs/releases/stdio.md — npm package release
- docs/releases/cloudflare.md — Cloudflare deployment

## Commands

```bash
# Development
pnpm run dev                              # Start dev server
pnpm run build                            # Build all packages

# Testing
pnpm -w run cli "who am I?"               # Test local dev server
pnpm -w run cli --access-token=TOKEN "q"  # Test stdio transport
pnpm -w run cli --agent "query"           # Test agent mode (~2x slower)

# Quality (run before committing)
pnpm run tsc && pnpm run lint && pnpm run test

# Token overhead
pnpm run measure-tokens                   # Check tool definition size
```

## Task Management

Use `/dex` skill to coordinate complex work. Create tasks with full context, break down into subtasks, complete with detailed results.

## Workflow

1. Check neighboring files for existing patterns before writing new code.
2. Update relevant docs when changing functionality.
3. Follow docs/error-handling.md for error types.
4. Follow docs/pr-management.md for commits and PRs.

## Commit Attribution

AI commits MUST include:
```
Co-Authored-By: (the agent model's name and attribution byline)
```
