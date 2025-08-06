# sentry-mcp

[![codecov](https://codecov.io/gh/getsentry/sentry-mcp/graph/badge.svg?token=khVKvJP5Ig)](https://codecov.io/gh/getsentry/sentry-mcp)

Sentry's MCP service is primarily designed for human-in-the-loop coding agents. Our tool selection and priorities are focused on developer workflows and debugging use cases, rather than providing a general-purpose MCP server for all Sentry functionality.

This remote MCP server acts as middleware to the upstream Sentry API, optimized for coding assistants like Cursor, Claude Code, and similar development tools. It's based on [Cloudflare's work towards remote MCPs](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/).

## Getting Started

You'll find everything you need to know by visiting the deployed service in production:

<https://mcp.sentry.dev>

If you're looking to contribute, learn how it works, or to run this for self-hosted Sentry, continue below..

### Stdio vs Remote

While this repository is focused on acting as an MCP service, we also support a `stdio` transport. This is still a work in progress, but is the easiest way to adapt run the MCP against a self-hosted Sentry install.

**Note:** The AI-powered search tools (`search_events` and `search_issues`) require an OpenAI API key. These tools use natural language processing to translate queries into Sentry's query syntax. Without the API key, these specific tools will be unavailable, but all other tools will function normally.

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
```

Note: You can also use environment variables:

```shell
SENTRY_ACCESS_TOKEN=
SENTRY_HOST=
OPENAI_API_KEY=  # Required for AI-powered search tools (search_events, search_issues)
```

### MCP Inspector

MCP includes an [Inspector](https://modelcontextprotocol.io/docs/tools/inspector), to easily test the service:

```shell
pnpm inspector
```

Enter the MCP server URL (<http://localhost:5173>) and hit connect. This should trigger the authentication flow for you.

Note: If you have issues with your OAuth flow when accessing the inspector on `127.0.0.1`, try using `localhost` instead by visiting `http://localhost:6274`.

## Local Development

To contribute changes against the server, you'll need to set things up in in local development. This will require you to create another OAuth App in Sentry (Settings => API => [Applications](https://sentry.io/settings/account/api/applications/)):

- For the Homepage URL, specify `http://localhost:5173`
- For the Authorized Redirect URIs, specify `http://localhost:5173/callback`
- Note your Client ID and generate a Client secret.
- Create a `.dev.vars` file in `packages/mcp-cloudflare/` root with:

```shell
# packages/mcp-cloudflare/.dev.vars
SENTRY_CLIENT_ID=your_development_sentry_client_id
SENTRY_CLIENT_SECRET=your_development_sentry_client_secret
COOKIE_SECRET=my-super-secret-cookie
```

### Verify

Run the server locally to make it available at `http://localhost:5173`

```shell
pnpm dev
```

To test the local server, enter `http://localhost:5173/mcp` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools".

### Tests

There are two test suites included: basic unit tests, and some evaluations.

Unit tests can be run using:

```shell
pnpm test
```

Evals will require a `.env` file with some config:

```shell
OPENAI_API_KEY=  # Also required for AI-powered search tools in production
```

Once that's done you can run them using:

```shell
pnpm eval
```

## Development Notes

### Automated Code Review

This repository uses automated code review tools (like Cursor BugBot) to help identify potential issues in pull requests. These tools provide helpful feedback and suggestions, but **we do not recommend making these checks required** as the accuracy is still evolving and can produce false positives.

The automated reviews should be treated as:
- ✅ **Helpful suggestions** to consider during code review
- ✅ **Starting points** for discussion and improvement  
- ❌ **Not blocking requirements** for merging PRs
- ❌ **Not replacements** for human code review

When addressing automated feedback, focus on the underlying concerns rather than strictly following every suggestion.
