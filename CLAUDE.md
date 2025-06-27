# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sentry MCP is a Model Context Protocol server that provides access to Sentry's functionality through tools, prompts, and resources.

- Our project in sentry is 'sentry/mcp-server'

## Documentation

All documentation is in the `docs/` directory:

### Core References

- `architecture.mdc` - System design and package structure
- `common-patterns.mdc` - Reusable code patterns
- `quality-checks.mdc` - Required quality checks

### Implementation Guides

- `adding-tools.mdc` - Adding new MCP tools
- `adding-prompts.mdc` - Adding new MCP prompts
- `adding-resources.mdc` - Adding new MCP resources

### Technical References

- `api-patterns.mdc` - Sentry API client usage
- `testing.mdc` - Testing strategies
- `deployment.mdc` - Cloudflare deployment
- `monitoring.mdc` - Observability patterns
- `security.mdc` - Authentication and security

You should ALWAYS update docs when they are inaccurate or you have learned new relevant information which would add clarity that is otherwise missing.

## Critical Quality Checks

**After ANY code changes, you MUST run:**

```bash
pnpm -w run lint:fix    # Fix linting issues
pnpm tsc --noEmit       # Check TypeScript types
pnpm test               # Run all tests
```

**DO NOT proceed if any check fails.**

## Essential Commands

```bash
# Development
pnpm dev                # Start all dev servers
pnpm build              # Build all packages
pnpm inspector          # Test tools interactively

# Testing
pnpm test               # Unit tests
pnpm eval               # Evaluation tests (needs OPENAI_API_KEY)

# MCP Client Testing
pnpm start:client       # Interactive MCP client (needs ANTHROPIC_API_KEY)
pnpm start:client:local # Use local stdio server

# Deployment
pnpm deploy             # Deploy to Cloudflare
```

## Quick Start

1. Install dependencies: `pnpm install`
2. For local testing: `pnpm start:stdio --access-token=<token>`
3. For development: `pnpm dev`
4. For client testing: `pnpm start:client` (requires ANTHROPIC_API_KEY)

## Claude Code-Specific Notes

When using Claude Code's MCP integration:

- The server runs via stdio transport
- Authentication uses access tokens (not OAuth)
- See integration docs in the web UI for setup instructions

## Environment Variables

See specific guides for required environment variables:

- Cloudflare: `deployment.mdc`
- Evaluation tests: `.env.example`
- Local development: Use command-line args
- MCP Client:
  - `ANTHROPIC_API_KEY` - Required for AI agent
  - `SENTRY_ACCESS_TOKEN` - Required for local stdio mode
  - `MCP_HOST` - Optional, defaults to https://mcp.sentry.dev (used by search_docs tool)

## References

- MCP Protocol: https://modelcontextprotocol.io
- Sentry API: https://docs.sentry.io/api/
