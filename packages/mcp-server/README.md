# sentry-mcp

This is a prototype of an MCP server, acting as a middleware to the upstream Sentry API provider.

This package is primarily for running the `stdio` MCP server. If you do not know what that is, or do not need it, we suggest using the public remote service:

<https://mcp.sentry.dev>

**Note:** Some tools require additional configuration:
- **AI-powered search tools** (`search_events` and `search_issues`): These tools use OpenAI to translate natural language queries into Sentry's query syntax. They require an `OPENAI_API_KEY` environment variable. Without this key, these specific tools will be unavailable, but all other tools will function normally.

## Authorization

The MCP server uses a **skills-based authorization system** that maps user-friendly capabilities to technical API permissions.

### Available Skills

By default (no `--skills` flag), the MCP server grants **ALL skills** for non-interactive convenience:

- **`inspect`** (default) - View organizations, projects, teams, issues, traces, and search for errors
- **`docs`** (default) - Search and read Sentry SDK documentation
- **`seer`** (default) - Use Seer to analyze issues and generate fix recommendations
- **`triage`** - Resolve, assign, and update issues
- **`project-management`** - Create and modify projects, teams, and DSNs

### Customizing Skills

You can limit which skills are granted using the `--skills` flag:

```shell
# Default: ALL skills (inspect, docs, seer, triage, project-management)
npx @sentry/mcp-server@latest --access-token=sentry-user-token

# Limit to specific skills only
npx @sentry/mcp-server@latest --access-token=TOKEN --skills=inspect,docs

# Self-hosted Sentry
npx @sentry/mcp-server@latest --access-token=TOKEN --host=sentry.example.com

# Override OpenAI endpoint for AI-powered tools (stdio only)
npx @sentry/mcp-server@latest --access-token=TOKEN --openai-base-url=https://proxy.example.com/v1
```

### Environment Variables

You can also use environment variables:

```shell
SENTRY_ACCESS_TOKEN=your-token
# Optional overrides. Leave unset to use the default SaaS host
SENTRY_HOST=sentry.example.com         # Self-hosted Sentry hostname
MCP_SKILLS=inspect,docs,triage         # Limit to specific skills
MCP_SCOPES=org:read,event:read         # Override default scopes (replaces defaults) - DEPRECATED, use MCP_SKILLS
MCP_ADD_SCOPES=event:write             # Add to default scopes (keeps defaults) - DEPRECATED, use MCP_SKILLS

# OpenAI configuration for AI-powered search tools
OPENAI_API_KEY=your-openai-key         # Required for AI-powered search tools (search_events, search_issues)
OPENAI_MODEL=gpt-5                     # OpenAI model to use (default: "gpt-5")
OPENAI_REASONING_EFFORT=low            # Reasoning effort for o1 models: "low", "medium", "high", or "" to disable (default: "low")

# No environment variable exists for the OpenAI base URL override; use --openai-base-url instead.
# This restriction prevents unexpected environment overrides that could silently reroute requests to a
# malicious proxy capable of harvesting the OpenAI API key provided at runtime.
```

If `SENTRY_HOST` is not provided, the CLI automatically targets the Sentry SaaS endpoint. Configure this variable only when you operate a self-hosted Sentry deployment.

**Note:** Command-line flags override environment variables.

### Required Sentry Token Scopes

To utilize the `stdio` transport, create a User Auth Token in Sentry with these scopes:

**Minimum (read-only)**:
- `org:read`, `project:read`, `team:read`, `event:read`

**Additional (for write operations)**:
- `event:write` - Required for `triage` skill
- `project:write`, `team:write` - Required for `project-management` skill

The MCP server will automatically request the appropriate scopes based on your granted skills.

### Migration from Scopes (Deprecated)

> ⚠️ **Deprecated**: The `--scopes` and `--add-scopes` flags are deprecated. Use `--skills` instead.

If you're currently using scopes:

```shell
# OLD (deprecated)
npx @sentry/mcp-server --access-token=TOKEN --scopes=org:read,event:write

# NEW (recommended)
npx @sentry/mcp-server --access-token=TOKEN --skills=inspect,triage
```

The host configuration accepts two distinct formats:

- **`SENTRY_HOST`**: Hostname only (no protocol)
  - Examples: `sentry.example.com`, `sentry.internal.example.com`, `localhost:8000`

**Note**: Only HTTPS connections are supported for security reasons.

By default we also enable Sentry reporting (traces, errors) upstream to our cloud service. You can disable that, or send it to a different Sentry instance by using the `--sentry-dsn` flag:

```shell
# disable sentry reporting
npx @sentry/mcp-server@latest --sentry-dsn=

# use custom sentry instance
npx @sentry/mcp-server@latest --sentry-dsn=https://publicKey@mysentry.example.com/...
```
