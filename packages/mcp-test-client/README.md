# MCP Client CLI

A simple CLI tool to test the Sentry MCP server using stdio transport with an AI agent powered by Vercel's AI SDK.

## Features

- 🤖 AI-powered interaction with Sentry MCP tools using GPT-4
- 🔧 Full access to all MCP server tools
- 💬 Interactive mode by default when no prompt provided
- 🎨 Colorized output for better readability
- 🔄 Streaming responses for real-time feedback
- 🌐 Remote MCP server support via SSE transport (with OAuth)
- 🏠 Local stdio transport for development

## Prerequisites

- Node.js >= 20
- pnpm package manager
- OpenAI API key
- Sentry access token with appropriate permissions

## Installation

From the package directory:

```bash
pnpm install
pnpm build
```

## Configuration

The MCP client supports multiple transport methods and authentication:

### 1. OAuth Authentication (Recommended for Remote Mode)

When using remote mode (default), the MCP client can authenticate via OAuth 2.1 with the MCP server:

```bash
# The client will automatically prompt for OAuth if no token is provided
pnpm mcp-test-client

# Or specify a custom MCP server
pnpm mcp-test-client --mcp-host http://localhost:8787
```

The OAuth flow uses PKCE (Proof Key for Code Exchange) and doesn't require a client secret, making it secure for CLI applications.

### 2. Environment Variables

Create a `.env` file in the package directory:

```env
# Required
OPENAI_API_KEY=your_openai_api_key

# Required - Sentry access token with appropriate permissions
SENTRY_ACCESS_TOKEN=your_sentry_access_token

# Optional
SENTRY_HOST=sentry.io  # For self-hosted Sentry instances (hostname or full URL)
MCP_URL=https://mcp.sentry.dev  # MCP server host (defaults to production)
MCP_MODEL=gpt-4o  # Override default model (GPT-4)

# Optional - Error tracking
SENTRY_DSN=your_sentry_dsn  # Error tracking for the client itself

# OAuth clients are automatically registered via Dynamic Client Registration (RFC 7591)
# No manual client ID configuration needed
```

### 3. Command Line Flags

```bash
pnpm mcp-test-client --access-token=your_token "Your prompt"
```

### Token Priority

The client automatically determines the connection mode:

**Local Mode (stdio transport)**: Used when an access token is provided via:

1. Command-line flag (`--access-token`)
2. Environment variable (`SENTRY_ACCESS_TOKEN`)
3. `.env` file

**Remote Mode (SSE transport)**: Used when no access token is provided, prompts for OAuth authentication

### Required Sentry Permissions

Your Sentry access token needs the following scopes:

- `org:read`
- `project:read`
- `project:write`
- `team:read`
- `team:write`
- `event:write`

## Usage

### Remote Mode (Default)

Connect to the remote MCP server via SSE transport (uses OAuth for authentication):

```bash
# Connect to production MCP server (uses /sse endpoint)
pnpm mcp-test-client

# Connect to local development MCP server
pnpm mcp-test-client --mcp-host http://localhost:8787
```

**Note**: Remote mode uses Server-Sent Events (SSE) transport and connects to the `/sse` endpoint on the MCP server.

### Local Mode

Use the local stdio transport by providing a Sentry access token:

```bash
# Using environment variable
SENTRY_ACCESS_TOKEN=your_token pnpm mcp-test-client

# Using command line flag
pnpm mcp-test-client --access-token your_token
```

### Interactive Mode (Default)

Start an interactive session by running without arguments:

```bash
pnpm mcp-test-client
```

In interactive mode:

- Type your prompts and press Enter
- Type `exit` or `quit` to end the session
- The AI maintains context across prompts

### Single Prompt Mode

Run with a specific prompt:

```bash
pnpm mcp-test-client "List all unresolved issues in my project"
```

### Advanced Options

Use a different AI model:

```bash
pnpm mcp-test-client --model gpt-4-turbo "Analyze my error trends"
```

Connect to a local MCP server:

```bash
pnpm mcp-test-client --mcp-host http://localhost:8787 "List my projects"
```

Use local stdio transport with custom Sentry host:

```bash
SENTRY_HOST=sentry.example.com SENTRY_ACCESS_TOKEN=your_token pnpm mcp-test-client "Show my projects"
```

## Development

### Running from Source

```bash
pnpm dev "Your prompt here"
```

### Building

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

## Troubleshooting

### Connection Issues

If you see "Failed to connect to MCP server":

1. Ensure the mcp-server package is built
2. Check that your access token is valid
3. Verify the Sentry host URL is correct

### Authentication Errors

If you get authentication errors:

1. Verify your OPENAI_API_KEY is set correctly
2. Check that your SENTRY_ACCESS_TOKEN has the required permissions
3. For self-hosted Sentry, ensure SENTRY_HOST is set

### Tool Errors

If tools fail to execute:

1. Check the error message for missing parameters
2. Ensure your Sentry token has appropriate permissions
3. Verify you have access to the requested resources

## Examples

### Finding and Analyzing Issues

```bash
# List recent issues
pnpm mcp-test-client "Show me issues from the last 24 hours"

# Search for specific errors
pnpm mcp-test-client "Find all TypeError issues in the frontend project"

# Get issue details
pnpm mcp-test-client "Show me details about issue FRONTEND-123"
```

### Project Management

```bash
# List all projects
pnpm mcp-test-client "List all my projects with their platforms"

# Get project settings
pnpm mcp-test-client "Show me the alert settings for my React project"

# View team assignments
pnpm mcp-test-client "Which teams have access to the mobile app project?"
```

### Performance Analysis

```bash
# Check slow transactions
pnpm mcp-test-client "Find the slowest API endpoints in the last hour"

# Analyze performance trends
pnpm mcp-test-client "Show me performance metrics for the checkout flow"
```

## Testing the Installation

After installation, you can verify everything is working:

```bash
# Check CLI is installed
pnpm mcp-test-client --help

# Test basic functionality (no API keys required)
SENTRY_ACCESS_TOKEN=dummy OPENAI_API_KEY=dummy pnpm mcp-test-client --help

# Run the test script (requires valid credentials)
./examples/test-connection.sh
```

## Authentication Methods

### Remote Mode (OAuth)

When connecting to a remote MCP server (default), the client supports OAuth 2.1 with PKCE:

- No client secret required (secure for CLI applications)
- Automatic browser-based authentication flow
- Tokens are securely stored in memory during the session

**Note**: OAuth clients are automatically registered using Dynamic Client Registration (RFC 7591). The client registration is cached in `~/.config/sentry-mcp/config.json` to avoid re-registration on subsequent authentications.

### Local Mode (Access Tokens)

When using local stdio transport (automatic when access token is provided), you must provide a Sentry access token:

- Set `SENTRY_ACCESS_TOKEN` environment variable
- Or use `--access-token` command-line flag
- Tokens need appropriate Sentry permissions (see Required Sentry Permissions section)

## Architecture

The CLI consists of these main components:

1. **MCP Client** (`mcp-test-client.ts`) - Handles connection to the MCP server
2. **AI Agent** (`agent.ts`) - Integrates with Vercel AI SDK for Claude
3. **Auth** (`auth/`) - OAuth flow and secure token storage
4. **CLI Interface** (`index.ts`) - Command-line argument parsing and modes

### Technical Notes

- The client uses `console.log` for all terminal output to maintain compatibility with the logger module
- Error tracking is available via the `SENTRY_DSN` environment variable
- All operations follow OpenTelemetry semantic conventions for observability

## Contributing

When adding new features:

1. Follow the existing code style
2. Add new test scenarios if applicable
3. Update this README with new usage examples
4. Ensure all TypeScript types are properly defined
5. Run quality checks: `pnpm lint:fix && pnpm typecheck && pnpm test`
