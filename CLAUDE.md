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

## Claude Code Notes

- Server runs via stdio transport
- Authentication uses access tokens (not OAuth)
