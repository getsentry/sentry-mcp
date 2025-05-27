#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "./transports/stdio";
import * as Sentry from "@sentry/node";
import { LIB_VERSION } from "./version";

// SENTRY_AUTH_TOKEN is deprecated, but we support it for backwards compatibility
let accessToken: string | undefined =
  process.env.SENTRY_ACCESS_TOKEN ?? process.env.SENTRY_AUTH_TOKEN;
let host: string | undefined = process.env.SENTRY_HOST;
let sentryDsn: string | undefined =
  process.env.SENTRY_DSN || process.env.DEFAULT_SENTRY_DSN;

const packageName = "@sentry/mcp-server";

function getUsage() {
  return `Usage: ${packageName} --access-token=<token> [--host=<host>] [--sentry-dsn=<dsn>]`;
}

for (const arg of process.argv.slice(2)) {
  if (arg === "--version" || arg === "-v") {
    console.log(`${packageName} ${LIB_VERSION}`);
    process.exit(0);
  }
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
    "Error: No access token was provided. Pass one with `--access-token` or via `SENTRY_ACCESS_TOKEN`.",
  );
  console.error(getUsage());
  process.exit(1);
}

Sentry.init({
  dsn: sentryDsn,
  sendDefaultPii: true,
  tracesSampleRate: 1,
  initialScope: {
    tags: {
      "mcp.server_version": LIB_VERSION,
      "mcp.transport": "stdio",
      "sentry.host": host,
    },
  },
  release: process.env.SENTRY_RELEASE,
  integrations: [
    Sentry.consoleLoggingIntegration(),
    Sentry.zodErrorsIntegration(),
  ],
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    (process.env.NODE_ENV !== "production" ? "development" : "production"),
});

const server = new McpServer({
  name: "Sentry MCP",
  version: LIB_VERSION,
});

const instrumentedServer = Sentry.wrapMcpServerWithSentry(server);

const SENTRY_TIMEOUT = 5000; // 5 seconds

// XXX: we could do what we're doing in routes/auth.ts and pass the context
// identically, but we don't really need userId and userName yet
startStdio(instrumentedServer, {
  accessToken,
  organizationSlug: null,
  host,
}).catch((err) => {
  console.error("Server error:", err);
  // ensure we've flushed all events
  Sentry.flush(SENTRY_TIMEOUT);
  process.exit(1);
});

// ensure we've flushed all events
Sentry.flush(SENTRY_TIMEOUT);
