# CLAUDE.md

<instructions>
This file provides optimized guidance for Claude Code (Sonnet 4 and Opus 4) when working with the sentry-mcp repository.
</instructions>

## 🎯 Core Directives

<behavior>
- **TypeScript**: NEVER use 'any' type. Use proper type annotations, unknown, or validated type assertions
- **Communication**: Direct, factual, concise. No fluff, niceties, or redundant explanations
- **Critical Thinking**: Verify claims. Challenge incorrect assumptions. Validate before proceeding
- **Code Quality**: Follow existing patterns. Check adjacent files for conventions. Never introduce security vulnerabilities
</behavior>

## 📋 Task Execution Protocol

<workflow>
1. **Understand**: Read relevant docs BEFORE coding (see mandatory reading sections)
2. **Plan**: Use TodoWrite for multi-step tasks (3+ steps)
3. **Implement**: Follow established patterns, check neighboring code
4. **Validate**: Run `pnpm run tsc && pnpm run lint && pnpm run test`
5. **Document**: Update relevant docs when changing functionality
</workflow>

## Repository Structure

```
sentry-mcp/
├── packages/
│   ├── mcp-server/           # Main MCP server (tools, prompts, resources)
│   │   ├── src/
│   │   │   ├── tools/        # 19 individual tool modules + utils
│   │   │   ├── prompts.ts    # MCP prompts
│   │   │   ├── resources.ts  # MCP resources
│   │   │   ├── server.ts     # MCP server configuration
│   │   │   ├── api-client/   # Sentry API client
│   │   │   └── internal/     # Shared utilities
│   │   └── scripts/          # Build scripts (tool definitions generation)
│   ├── mcp-cloudflare/       # Cloudflare Worker chat application
│   │   ├── src/
│   │   │   ├── client/       # React frontend
│   │   │   └── server/       # Worker API routes
│   │   └── components.json   # Shadcn/ui config
│   ├── mcp-server-evals/     # AI evaluation tests
│   ├── mcp-server-mocks/     # MSW mocks for testing
│   ├── mcp-server-tsconfig/  # Shared TypeScript configs
│   └── mcp-test-client/      # MCP client for testing
└── docs/                     # All documentation
    ├── cloudflare/           # Web app docs
    └── llms/                 # LLM-specific docs
```

## Core Components Impact Analysis

When making changes, consider these areas:

### MCP Server (`packages/mcp-server/`)
- **Tools** (19 modules): Query, create, update Sentry resources
- **Prompts**: Help text and guidance for LLMs  
- **Resources**: Static documentation and references
- **API Client**: Sentry API integration layer
- **Server**: MCP protocol handler and error formatting

#### AI-Powered Search Tools Architecture

Two tools (`search_events` and `search_issues`) use embedded AI agents for natural language query translation:

**search_events** (`packages/mcp-server/src/tools/search-events/`):
- **Purpose**: Translates natural language to Sentry Discover queries for events/aggregations
- **Agent**: Uses OpenAI GPT-4o with structured outputs to generate DiscoverQL syntax
- **Tools**: Access to `datasetAttributes` (field discovery), `otelSemantics` (OpenTelemetry lookups), and `whoami` (user context)
- **Output**: Event lists, counts, aggregations, and statistical data
- **Example**: "how many errors today" → `level:error` with `count()` aggregation and `timeRange: "24h"`

**search_issues** (`packages/mcp-server/src/tools/search-issues/`):
- **Purpose**: Translates natural language to Sentry issue search queries for grouped problems
- **Agent**: Uses OpenAI GPT-4o with structured outputs to generate issue search syntax
- **Tools**: Access to `issueFields` (field discovery) and `whoami` (user context) 
- **Output**: Lists of grouped issues with metadata (status, assignee, user count)
- **Example**: "critical bugs assigned to me" → `level:error is:unresolved assignedOrSuggested:user@email.com`

**Shared Agent Infrastructure** (`packages/mcp-server/src/agent-tools/`):
- **Field Discovery**: Dynamic field discovery using Sentry's dataset APIs for project-specific attributes
- **User Resolution**: Resolves 'me' references to actual user email addresses via `whoami`
- **Error Handling**: Self-correction loops where validation errors are fed back to the agent for retry
- **Requirements**: Requires `OPENAI_API_KEY` environment variable for AI-powered query translation

### Cloudflare Web App (`packages/mcp-cloudflare/`)
- **Client**: React-based chat interface with UI components
- **Server**: Worker API routes for search, auth, MCP communication
- **Integration**: Uses MCP server for tool execution

### Testing Infrastructure
- **Unit Tests**: Co-located with each component
- **Mocks**: Realistic API responses in `mcp-server-mocks/`
- **Evaluations**: AI-driven integration tests in `mcp-server-evals/`
- **Test Client**: Interactive MCP testing in `mcp-test-client/`

### Build System
- **Tool Definitions**: Auto-generated JSON schemas for client consumption
- **TypeScript Config**: Shared configurations in `mcp-server-tsconfig/`
- **Packaging**: Multiple package coordination
- **OpenTelemetry Namespaces**: Run `pnpm run generate-otel-namespaces` to update namespace documentation from OpenTelemetry specs

## 🚨 MANDATORY Pre-Development Reading

<critical-requirements>
BEFORE writing ANY code:

### Component Development
- Tools → READ: `docs/adding-tools.mdc`
- Prompts → READ: `docs/adding-prompts.mdc`
- Resources → READ: `docs/adding-resources.mdc`
- Testing → READ: `docs/testing.mdc`

### Code Patterns
- Patterns → READ: `docs/common-patterns.mdc`
- API Usage → READ: `docs/api-patterns.mdc`
- Limits: Tools ≤20 (hard limit: 25), Prompts/Resources: reasonable count
</critical-requirements>

## ✅ Validation & Documentation

<validation>
AFTER code changes, ALWAYS:
```bash
pnpm run tsc     # Type safety
pnpm run lint    # Code style
pnpm run test    # Component tests
```
See `docs/quality-checks.mdc` for full checklist
</validation>

<documentation>
Docs are MANDATORY, not optional:
- Update docs when changing functionality
- Keep CLAUDE.md ↔ cursor.mdc synchronized
- Update: tools, prompts, resources, API patterns, architecture docs
</documentation>

## Pull Request Creation

**MANDATORY when creating PRs:**
- MUST read `docs/pr-management.mdc` for PR guidelines and template
- Follow the PR description structure in the documentation
- Use proper commit message format as specified
- Include Claude Code attribution in PR descriptions

## 🔢 Hard Limits

<limits>
- **Tools**: Target ~20, NEVER exceed 25 (AI agent constraint)
- **Prompts**: Reasonable count, well-documented
- **Resources**: Reasonable count, well-documented
</limits>

## Documentation Directory

- `docs/adding-tools.mdc` - Tool development
- `docs/adding-prompts.mdc` - Prompt development  
- `docs/adding-resources.mdc` - Resource development
- `docs/testing.mdc` - Testing requirements for all components
- `docs/common-patterns.mdc` - Code patterns
- `docs/api-patterns.mdc` - API usage
- `docs/architecture.mdc` - System design
- `docs/quality-checks.mdc` - Required quality checks
- `docs/pr-management.mdc` - Pull request guidelines and templates

## 🔧 Environment Context

<context>
**Claude Code**:
- Transport: stdio
- Auth: access tokens (NOT OAuth)

**Sentry Defaults**:
- Organization: 'sentry'
- Project: 'mcp-server'
</context>

## 🧠 Reasoning Guidelines

<thinking>
When tackling complex tasks:
1. Break down the problem into steps
2. Consider edge cases and error scenarios
3. Validate assumptions against codebase
4. Check existing patterns before implementing
</thinking>