# sentry-mcp

This is a prototype of a remote MCP sever, acting as a middleware to the upstream Sentry API provider.

It is based on [Cloudflare's work towards remote MCPs](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/).

## Getting Started

### MCP Inspector

MCP includes an [Inspector](https://modelcontextprotocol.io/docs/tools/inspector), to easily test the service:

```shell
pnpm inspector
```

Enter `https://[domain].workers.dev/sse` (TODO) and hit connect. Once you go through the authentication flow, you'll see the Tools working:

<img width="640" alt="image" src="https://github.com/user-attachments/assets/7973f392-0a9d-4712-b679-6dd23f824287" />

### Access the remote MCP server from Claude Desktop

Open Claude Desktop and navigate to Settings, press `⌘ + ,` (comma) -> Developer -> Edit Config. This opens the configuration file that controls which MCP servers Claude can access.

Replace the content with the following configuration. Once you restart Claude Desktop, a browser window will open showing your OAuth login page. Complete the authentication flow to grant Claude access to your MCP server. After you grant access, the tools will become available for you to use.

```json
{
  "mcpServers": {
    "math": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-github-oauth.<your-subdomain>.workers.dev/sse"
      ]
    }
  }
}
```

Once the Tools (under 🔨) show up in the interface, you can ask Claude to use them. For example: "Could you use the math tool to add 23 and 19?". Claude should invoke the tool and show the result generated by the MCP server.

### For Local Development

If you'd like to iterate and test your MCP server, you can do so in local development. This will require you to create another OAuth App in Sentry (Settings => API => [Applications](https://sentry.io/settings/account/api/applications/)):

- For the Homepage URL, specify `http://localhost:8788`
- For the Authorized Redirect URIs, specify `http://localhost:8788/callback`
- Note your Client ID and generate a Client secret.
- Create a `.dev.vars` file in your project root with:

```shell
SENTRY_CLIENT_ID=your_development_sentry_client_id
SENTRY_CLIENT_SECRET=your_development_sentry_client_secret
```

#### Develop & Test

Run the server locally to make it available at `http://localhost:8788`

```shell
pnpm dev
```

To test the local server, enter `http://localhost:8788/sse` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools".

#### Using Claude and other MCP Clients

When using Claude to connect to your remote MCP server, you may see some error messages. This is because Claude Desktop doesn't yet support remote MCP servers, so it sometimes gets confused. To verify whether the MCP server is connected, hover over the 🔨 icon in the bottom right corner of Claude's interface. You should see your tools available there.

#### Using Cursor and other MCP Clients

To connect Cursor with your MCP server, choose `Type`: "Command" and in the `Command` field, combine the command and args fields into one (e.g. `npx mcp-remote https://<your-worker-name>.<your-subdomain>.workers.dev/sse`).

Note that while Cursor supports HTTP+SSE servers, it doesn't support authentication, so you still need to use `mcp-remote` (and to use a STDIO server, not an HTTP one).

You can connect your MCP server to other MCP clients like Windsurf by opening the client's configuration file, adding the same JSON that was used for the Claude setup, and restarting the MCP client.

## How does it work?

#### OAuth Provider

The OAuth Provider library serves as a complete OAuth 2.1 server implementation for Cloudflare Workers. It handles the complexities of the OAuth flow, including token issuance, validation, and management. In this project, it plays the dual role of:

- Authenticating MCP clients that connect to your server
- Managing the connection to GitHub's OAuth services
- Securely storing tokens and authentication state in KV storage

#### Durable MCP

Durable MCP extends the base MCP functionality with Cloudflare's Durable Objects, providing:

- Persistent state management for your MCP server
- Secure storage of authentication context between requests
- Access to authenticated user information via `this.props`
- Support for conditional tool availability based on user identity

#### MCP Remote

The MCP Remote library enables your server to expose tools that can be invoked by MCP clients like the Inspector. It:

- Defines the protocol for communication between clients and your server
- Provides a structured way to define tools
- Handles serialization and deserialization of requests and responses
- Maintains the Server-Sent Events (SSE) connection between clients and your server
