# sentry-mcp

[![codecov](https://codecov.io/gh/getsentry/sentry-mcp/graph/badge.svg?token=khVKvJP5Ig)](https://codecov.io/gh/getsentry/sentry-mcp)
[![smithery badge](https://smithery.ai/badge/@getsentry/sentry-mcp)](https://smithery.ai/server/@getsentry/sentry-mcp)

This is a prototype of a remote MCP sever, acting as a middleware to the upstream Sentry API provider.

It is based on [Cloudflare's work towards remote MCPs](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/).

## Getting Started

You'll find everything you need to know by visiting the deployed service in production:

<https://mcp.sentry.dev>

If you're looking to contribute, learn how it works, or to run this for self-hosted Sentry, continue below..

### Stdio vs Remote

While this repository is focused on acting as an MCP service, we also support a `stdio` transport. This is still a work in progress, but is the easiest way to adapt run the MCP against a self-hosted Sentry install.

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

### MCP Inspector

MCP includes an [Inspector](https://modelcontextprotocol.io/docs/tools/inspector), to easily test the service:

```shell
pnpm inspector
```

Enter the MCP server URL (http://localhost:5173) and hit connect. This should trigger the authentication flow for you.

Note: If you have issues with your OAuth flow when accessing the inspector on `127.0.0.1`, try using `localhost` instead by visiting `http://localhost:6274`.

## Local Development

If you'd like to iterate and test your MCP server, you can do so in local development. This will require you to create another OAuth App in Sentry (Settings => API => [Applications](https://sentry.io/settings/account/api/applications/)):

- For the Homepage URL, specify `http://localhost:8788`
- For the Authorized Redirect URIs, specify `http://localhost:8788/callback`
- Note your Client ID and generate a Client secret.
- Create a `.dev.vars` file in your project root with:

```shell
SENTRY_CLIENT_ID=your_development_sentry_client_id
SENTRY_CLIENT_SECRET=your_development_sentry_client_secret
```

### Verify

Run the server locally to make it available at `http://localhost:8788`

```shell
pnpm dev
```

To test the local server, enter `http://localhost:8788/sse` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools".

### Tests

There are two test suites included: basic unit tests, and some evaluations.

Unit tests can be run using:

```shell
pnpm test
```

Evals will require a `.env` file with some config:

```shell
OPENAI_API_KEY=
```

Once thats done you can run them using:

```shell
pnpm test
```

## Notes

### Using Claude and other MCP Clients

When using Claude to connect to your remote MCP server, you may see some error messages. This is because Claude Desktop doesn't yet support remote MCP servers, so it sometimes gets confused. To verify whether the MCP server is connected, hover over the 🔨 icon in the bottom right corner of Claude's interface. You should see your tools available there.

### Using Cursor and other MCP Clients

To connect Cursor with your MCP server, choose `Type`: "Command" and in the `Command` field, combine the command and args fields into one (e.g. `npx mcp-remote@latest https://<your-worker-name>.<your-subdomain>.workers.dev/sse`).

Note that while Cursor supports HTTP+SSE servers, it doesn't support authentication, so you still need to use `mcp-remote` (and to use a STDIO server, not an HTTP one).

You can connect your MCP server to other MCP clients like Windsurf by opening the client's configuration file, adding the same JSON that was used for the Claude setup, and restarting the MCP client.
