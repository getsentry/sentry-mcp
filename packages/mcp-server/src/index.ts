#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "./transports/stdio";
import { wrapMcpServerWithSentry } from "@sentry/core";
import * as Sentry from "@sentry/node";

let accessToken: string | undefined = process.env.SENTRY_AUTH_TOKEN;
let host: string | undefined = process.env.SENTRY_HOST;
let sentryDsn: string | undefined = process.env.SENTRY_DSN;

const command = "@sentry/mcp-server";
function getUsage() {
  return `Usage: ${command} --access-token=<token> [--host=<host>] [--sentry-dsn=<dsn>]`;
}

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--access-token=")) {
    accessToken = arg.split("=")[1];
  } else if (arg.startsWith("--host=")) {
    host = arg.split("=")[1];
  } else if (arg.startsWith("--sentry-dsn=")) {
    sentryDsn = arg.split("=")[1];
  } else {
    console.error("Error: Invalid argument:", arg);
    console.error(getUsage());
    process.exit(1);
  }
}

if (!accessToken) {
  console.error(
    "Error: No access token was provided. Pass one with `--access-token` or via `SENTRY_AUTH_TOKEN`.",
  );
  console.error(getUsage());
  process.exit(1);
}

Sentry.init({
  dsn: sentryDsn,
  sendDefaultPii: true,
});

const server = new McpServer({
  name: "Sentry MCP",
  version: "0.1.0",
});

const instrumentedServer = wrapMcpServerWithSentry(server);

// XXX: we could do what we're doing in routes/auth.ts and pass the context
// identically, but we don't really need userId and userName yet
startStdio(instrumentedServer, {
  accessToken,
  organizationSlug: null,
  host,
}).catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
