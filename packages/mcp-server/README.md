# sentry-mcp

This is a prototype of an MCP server, acting as a middleware to the upstream Sentry API provider.

This package is primarily for running the `stdio` MCP server. If you do not know what that is, or do not need it, we suggest using the public remote service:

<https://mcp.sentry.dev>

**Note:** Some tools require additional configuration:
- **AI-powered search tools** (`search_events` and `search_issues`): These tools use OpenAI to translate natural language queries into Sentry's query syntax. They require an `OPENAI_API_KEY` environment variable. Without this key, these specific tools will be unavailable, but all other tools will function normally.

## Permissions and Scopes

By default, the MCP server runs with **read-only access** to your Sentry data:
- `org:read`, `project:read`, `team:read`, `event:read`

### Customizing Permissions

You can customize permissions using two different approaches:

- **`--scopes`**: **Override** the default scopes completely (replaces all defaults)
- **`--add-scopes`**: **Add** scopes to the default read-only set (keeps defaults and adds more)

To utilize the `stdio` transport, you'll need to create an User Auth Token in Sentry. The token must have at least read access, but you can grant additional permissions as needed.

### Examples

```shell
# Default read-only access (SaaS)
npx @sentry/mcp-server@latest --access-token=sentry-user-token

# Override with specific scopes only (removes defaults)
npx @sentry/mcp-server@latest --access-token=TOKEN --scopes=org:read,event:read

# Add write permissions to defaults (keeps all defaults)
npx @sentry/mcp-server@latest --access-token=TOKEN --add-scopes=event:write,project:write

# Point at a self-hosted deployment
npx @sentry/mcp-server@latest --access-token=sentry-user-token --host=sentry.example.com

# Override the OpenAI API endpoint for embedded agents (stdio only)
npx @sentry/mcp-server@latest --access-token=TOKEN --openai-base-url=https://proxy.example.com/v1
```

### Environment Variables

You can also use environment variables:

```shell
SENTRY_ACCESS_TOKEN=your-token
# Optional overrides. Leave unset to use the default SaaS host
SENTRY_HOST=sentry.example.com
MCP_SCOPES=org:read,event:read     # Override default scopes (replaces defaults)
MCP_ADD_SCOPES=event:write         # Add to default scopes (keeps defaults)
OPENAI_API_KEY=your-openai-key     # Required for AI-powered search tools (search_events, search_issues)
# No environment variable exists for the OpenAI base URL override; use --openai-base-url instead.
# This restriction prevents unexpected environment overrides that could silently reroute requests to a
# malicious proxy capable of harvesting the OpenAI API key provided at runtime.
```

If `SENTRY_HOST` is not provided, the CLI automatically targets the Sentry SaaS
endpoint.

Configure this variable only when you operate a self-hosted Sentry deployment;
it is not needed for Sentry SaaS.

**Important:** The `MCP_SCOPES` environment variable or `--scopes` flag completely replaces the default scopes. Use `MCP_ADD_SCOPES` or `--add-scopes` if you want to keep the default read-only permissions and add additional ones.

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
