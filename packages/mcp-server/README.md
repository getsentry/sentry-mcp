# sentry-mcp

This is a prototype of an MCP sever, acting as a middleware to the upstream Sentry API provider.

This package is primarily for running the `stdio` MCP server. If you do not know what that is, or do not need it, we suggest using the public remote service:

<https://mcp.sentry.dev>

To utilize the `stdoio` transport, you'll need to create an Personal API Token (PAT) in Sentry with the necessary scopes. As of writing this is:

```
org:read
project:read
project:write
team:read
team:write
event:read
```

Launch the transport:

```shell
npx @sentry/mcp-server@latest --access-token=sentry-pat --host=sentry.example.com
```

Note: You can also use environment variables:

```shell
SENTRY_AUTH_TOKEN=
SENTRY_HOST=
```
