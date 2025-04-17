#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "../transports/stdio.js";

const accessToken = process.env.SENTRY_AUTH_TOKEN;

if (!accessToken) {
  console.error("SENTRY_AUTH_TOKEN is not set");
  process.exit(1);
}

const server = new McpServer({
  name: "Sentry MCP",
  version: "0.1.0",
});

// XXX: we could do what we're doing in routes/auth.ts and pass the context
// identically, but we don't really need userId and userName yet
startStdio(server, {
  accessToken,
  organizationSlug: null,
}).catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
