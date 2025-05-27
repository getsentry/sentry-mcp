# sentry-mcp

This is a prototype of an MCP sever, acting as a middleware to the upstream Sentry API provider.

This package is primarily for running the `stdio` MCP server. If you do not know what that is, or do not need it, we suggest using the public remote service:

<https://mcp.sentry.dev>

To utilize the `stdio` transport, you'll need to create an User Auth Token in Sentry with the necessary scopes. As of writing this is:

```
org:read
project:write
team:write
event:read
```

Launch the transport:

```shell
npx @sentry/mcp-server@latest --access-token=sentry-user-token --host=sentry.example.com
```

Note: You can also use environment variables:

```shell
SENTRY_ACCESS_TOKEN=
SENTRY_HOST=
```

By default we also enable Sentry reporting (traces, errors) upstream to our cloud service. You can disable that, or send it to a different Sentry instance by using the `--sentry-dsn` flag:

```shell
# disable sentry reporting
npx @sentry/mcp-server@latest --sentry-dsn=

# disable sentry reporting
npx @sentry/mcp-server@latest --sentry-dsn=https://publicKey@mysentry.example.com/...
```
