# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sentry-mcp is a Model Context Protocol (MCP) server that provides access to Sentry's functionality. It supports both remote deployment via Cloudflare Workers and local stdio transport for self-hosted Sentry installations.

### Directory Structure

- **packages/mcp-server/src/**
  - `api-client/` - Sentry API client implementation
  - `internal/` - Internal utilities (formatting, validation) not exposed in public API
  - `transports/` - Transport implementations (stdio)
  - Root files: Core server logic, tool implementations, type definitions
- **packages/mcp-cloudflare/** - Cloudflare Workers deployment with OAuth
- **packages/mcp-server-evals/** - Evaluation tests for real Sentry operations
- **packages/mcp-server-mocks/** - Shared mock data fixtures

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

Note: Cloudflare deployment requires setting up Durable Objects and KV namespaces. These are configured in `wrangler.jsonc`.

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

Additional environment variables used by the build system (set in CI or locally as needed):
- `SENTRY_AUTH_TOKEN` - For Sentry telemetry/releases
- `VITE_SENTRY_DSN` - Sentry DSN for error tracking
- `VITE_SENTRY_ENVIRONMENT` - Environment name for Sentry

### Code Style

- Uses Biome for formatting and linting
- 2-space indentation
- Pre-commit hooks run formatting and linting on staged files
- TypeScript strict mode enabled

## Testing Strategy

1. **Unit Tests**: Located alongside source files, run with `pnpm test`
2. **Evaluation Tests**: In packages/mcp-server-evals, test real Sentry operations, run with `pnpm eval`
3. **Coverage**: Uses Vitest with V8 coverage provider
4. **Snapshot Testing**: For testing formatted outputs (like error messages, stack traces), use `.toMatchInlineSnapshot()` instead of `.toContain()` to capture the exact output format

## Common Development Tasks

### Adding a New Sentry Tool

1. Add the tool implementation to `packages/mcp-server/src/tools.ts`
2. Define the tool schema in `packages/mcp-server/src/toolDefinitions.ts`
3. Add corresponding unit tests alongside the implementation
4. Add evaluation tests in `packages/mcp-server-evals/src/evals/`
5. If needed, add mock data to `packages/mcp-server-mocks/src/`

### Error Handling

- Use `UserInputError` from `packages/mcp-server/src/errors.ts` for invalid user input
- This error type provides clear feedback to the LLM about what went wrong
- Other errors will be treated as system errors

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

### Pre-PR Checklist

Before submitting a pull request:
```bash
pnpm lint:fix     # Fix any linting issues
pnpm format       # Format code with Biome
pnpm build        # Ensure everything builds
pnpm test         # Run unit tests
```

### Build Artifacts

- Build outputs go to `dist/` directories (gitignored)
- `.tsbuildinfo` files are for incremental builds (gitignored)
- Turbo cache is stored in `.turbo/` (gitignored)

## Integration Documentation

The MCP server supports multiple AI assistant clients. Integration guides are provided in the web UI for both remote (OAuth) and stdio transport configurations.

### Integration UI Components

Integration documentation is implemented in `packages/mcp-cloudflare/src/client/components/fragments/`:
- `remote-setup.tsx` - Instructions for OAuth-based remote connections
- `stdio-setup.tsx` - Instructions for local stdio transport connections
- `setup-guide.tsx` - Reusable component for individual integration guides

### Supported Integrations

Integrations are ordered by popularity:
1. **Cursor** - Popular AI code editor
2. **Claude Code** - Anthropic's official CLI
3. **Windsurf** - Code editor with AI capabilities
4. **Visual Studio Code** - Microsoft's editor with MCP extension
5. **Zed** - Modern code editor

### Adding a New Client Integration

To add support for a new MCP client:

1. Add a new `<SetupGuide>` component in both `remote-setup.tsx` and `stdio-setup.tsx`
2. Include step-by-step instructions specific to that client
3. Use `<CodeSnippet>` components for configuration examples
4. Consider the integration's popularity when determining its order in the list
5. Test the instructions with the actual client to ensure accuracy

Example structure:
```tsx
<SetupGuide id="client-name" title="Client Name">
  <ol>
    <li>Step 1 instructions</li>
    <li>Step 2 with <CodeSnippet snippet={configExample} /></li>
  </ol>
  <p><small>Additional notes or links</small></p>
</SetupGuide>
```

### Integration Configuration Patterns

Different clients use different configuration formats:
- **Cursor/Windsurf**: Use `mcpServers` object in JSON config
- **Claude Code**: Uses CLI commands with `claude mcp add`
- **VS Code**: Supports both manual config and automatic setup via handler URL
- **Zed**: Uses `context_servers` configuration

When adding new integrations, follow the existing patterns and ensure configuration examples are consistent with the client's expected format.