#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "@sentry/mcp-server/transports/stdio";
import { mswServer } from "@sentry/mcp-server-mocks";
import type { Scope } from "@sentry/mcp-server/permissions";
import { ALL_SCOPES } from "@sentry/mcp-server/permissions";

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

// Grant all available scopes for evals to ensure MSW mocks apply broadly

const server = new McpServer({
  name: "Sentry MCP",
  version: "0.1.0",
});

// Run in-process MCP with all scopes so MSW mocks apply
startStdio(server, {
  accessToken,
  grantedScopes: new Set<Scope>(ALL_SCOPES),
  constraints: {
    organizationSlug: null,
    projectSlug: null,
  },
}).catch((err: unknown) => {
  console.error("Server error:", err);
  process.exit(1);
});
