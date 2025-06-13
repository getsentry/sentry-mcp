# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sentry-mcp is a Model Context Protocol (MCP) server that provides access to Sentry's functionality. It supports both remote deployment via Cloudflare Workers and local stdio transport for self-hosted Sentry installations.

## Essential Commands

### Development
```bash
pnpm dev                # Start development servers (all packages)
pnpm build              # Build all packages
pnpm start:stdio        # Start stdio transport server locally
```

### Testing
```bash
pnpm test               # Run unit tests
pnpm test:ci            # Run tests with coverage for CI
pnpm eval               # Run evaluation tests (requires OPENAI_API_KEY)
```

### Code Quality
```bash
pnpm lint               # Run linting
pnpm lint:fix           # Fix linting issues
pnpm format             # Format code with Biome
```

### Deployment
```bash
pnpm deploy             # Deploy to Cloudflare (from packages/mcp-cloudflare)
```

### Debugging
```bash
pnpm inspector          # Launch MCP Inspector for testing tools
```

## Architecture

The project is a pnpm monorepo with these key packages:

- **packages/mcp-server**: Core MCP server implementation that exposes Sentry API functionality. This is the npm-publishable package.
- **packages/mcp-cloudflare**: Cloudflare Workers deployment with OAuth flow and React UI for setup instructions.
- **packages/mcp-server-evals**: Evaluation tests for testing Sentry operations against real scenarios.
- **packages/mcp-server-mocks**: Shared mock data and utilities for testing.

### Key Architectural Decisions

1. **Protocol Implementation**: Uses the MCP SDK to expose Sentry operations as tools that can be called by AI assistants.

2. **Transport Layers**:
   - Stdio transport for local/self-hosted usage
   - HTTP transport via Cloudflare Workers for cloud deployment

3. **Authentication**:
   - OAuth flow for cloud deployment (packages/mcp-cloudflare)
   - Access tokens for stdio transport

4. **Build System**: Uses Turbo for monorepo task orchestration with dependency-aware builds.

## Development Setup

### Environment Variables

For Cloudflare development, create `packages/mcp-cloudflare/.dev.vars`:
```
SENTRY_CLIENT_ID=your_development_sentry_client_id
SENTRY_CLIENT_SECRET=your_development_sentry_client_secret
COOKIE_SECRET=my-super-secret-cookie
```

For evaluation tests, create `.env` in the root:
```
OPENAI_API_KEY=your_openai_api_key
```

### Code Style

- Uses Biome for formatting and linting
- 2-space indentation
- Pre-commit hooks run formatting and linting on staged files
- TypeScript strict mode enabled

## Testing Strategy

1. **Unit Tests**: Located alongside source files, run with `pnpm test`
2. **Evaluation Tests**: In packages/mcp-server-evals, test real Sentry operations, run with `pnpm eval`
3. **Coverage**: Uses Vitest with V8 coverage provider

## Common Development Tasks

### Adding a New Sentry Tool

1. Implement the tool in `packages/mcp-server/src/tools/`
2. Add corresponding tests
3. Update the tool registry
4. Add evaluation tests if applicable

### Testing Changes Locally

1. Use `pnpm inspector` to test tools interactively
2. For stdio transport: `pnpm start:stdio --access-token=<token> --host=<host>`
3. For Cloudflare: `pnpm dev` and navigate to the local server

### Updating Dependencies

Use pnpm to maintain consistency:
```bash
pnpm add <package> -w              # Add to root
pnpm add <package> --filter <pkg>  # Add to specific package
```