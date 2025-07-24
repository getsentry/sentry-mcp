# sentry-mcp

This is a prototype of an MCP server, acting as a middleware to the upstream Sentry API provider.

This package is primarily for running the `stdio` MCP server. If you do not know what that is, or do not need it, we suggest using the public remote service:

<https://mcp.sentry.dev>

**Note:** Some tools require additional configuration:
- **AI-powered search tools** (`search_events` and `search_issues`): These tools use OpenAI to translate natural language queries into Sentry's query syntax. They require an `OPENAI_API_KEY` environment variable. Without this key, these specific tools will be unavailable, but all other tools will function normally.

To utilize the `stdio` transport, you'll need to create an User Auth Token in Sentry with the necessary scopes. As of writing this is:

```
org:read
project:read
project:write
team:read
team:write
event:write
```

Launch the transport:

```shell
npx @sentry/mcp-server@latest --access-token=sentry-user-token --host=sentry.example.com
# or with full URL
npx @sentry/mcp-server@latest --access-token=sentry-user-token --url=https://sentry.example.com
```

Note: You can also use environment variables:

```shell
SENTRY_ACCESS_TOKEN=your-token
SENTRY_HOST=sentry.example.com     # Custom hostname
SENTRY_URL=https://sentry.io       # OR base URL (precedence over SENTRY_HOST)
OPENAI_API_KEY=your-openai-key     # Required for AI-powered search tools (search_events, search_issues)
```

The host configuration accepts two distinct formats:

- **`SENTRY_HOST`**: Hostname only (no protocol)
  - Examples: `sentry.io`, `sentry.example.com`, `localhost:8000`
- **`SENTRY_URL`**: Full URLs (hostname will be extracted)
  - Examples: `https://sentry.io`, `https://sentry.example.com`
  - Takes precedence over `SENTRY_HOST` if both are provided

**Note**: Only HTTPS connections are supported for security reasons.

By default we also enable Sentry reporting (traces, errors) upstream to our cloud service. You can disable that, or send it to a different Sentry instance by using the `--sentry-dsn` flag:

```shell
# disable sentry reporting
npx @sentry/mcp-server@latest --sentry-dsn=

# use custom sentry instance
npx @sentry/mcp-server@latest --sentry-dsn=https://publicKey@mysentry.example.com/...
```
