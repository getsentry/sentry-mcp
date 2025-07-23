# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

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

## 🔴 CRITICAL: Pre-Development Requirements

**MANDATORY READING before ANY code changes:**

### MCP Component Development
- **Tools**: MUST read `docs/adding-tools.mdc` 
- **Prompts**: MUST read `docs/adding-prompts.mdc`
- **Resources**: MUST read `docs/adding-resources.mdc`
- **Testing**: MUST read `docs/testing.mdc` for all components

### Code Changes
- MUST read `docs/common-patterns.mdc` for established patterns
- MUST read `docs/api-patterns.mdc` for API usage
- MUST verify component count limits (tools: ~20 max, prompts/resources: reasonable limits)

## Documentation Maintenance Requirements

**MANDATORY: Documentation MUST be updated when making code changes**
- Documentation updates are not optional - they are part of completing any task
- CLAUDE.md ↔ cursor.mdc must stay synchronized
- Update relevant docs for tools, prompts, resources, API patterns, or architecture changes

## Code Validation Requirements

**MANDATORY after ANY code changes:**
- Run `pnpm run tsc` to verify type safety
- Run `pnpm run lint` to check code style  
- Run `pnpm run test` for affected components
- See `docs/quality-checks.mdc` for complete checklist

## Pull Request Creation

**MANDATORY when creating PRs:**
- MUST read `docs/pr-management.mdc` for PR guidelines and template
- Follow the PR description structure in the documentation
- Use proper commit message format as specified
- Include Claude Code attribution in PR descriptions

## Component Limits

**IMPORTANT**: 
- **Tools**: Target ~20, never exceed 25 (AI agent hard limitations)
- **Prompts**: Keep reasonable, well-documented
- **Resources**: Keep reasonable, well-documented

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

## Claude Code Notes

- Server runs via stdio transport
- Authentication uses access tokens (not OAuth)

## Sentry Organization and Project Information

- Organization: 'sentry'
- Project: 'mcp-server'