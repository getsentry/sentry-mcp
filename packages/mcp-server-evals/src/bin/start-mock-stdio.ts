#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "@sentry/mcp-server/transports/stdio";
import { mswServer } from "@sentry/mcp-server-mocks";

mswServer.listen({
  onUnhandledRequest: (req, print) => {
    if (req.url.startsWith("https://api.openai.com/")) {
      return;
    }

    print.warning();
    throw new Error(`Unhandled request: ${req.url}`);
  },
  // onUnhandledRequest: "error"
});

const accessToken = "mocked-access-token";

const server = new McpServer({
  name: "Sentry MCP",
  version: "0.1.0",
});

// XXX: we could do what we're doing in routes/auth.ts and pass the context
// identically, but we don't really need userId and userName yet
startStdio(server, {
  accessToken,
  organizationSlug: null,
}).catch((err: unknown) => {
  console.error("Server error:", err);
  process.exit(1);
});
