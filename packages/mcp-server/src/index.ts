#!/usr/bin/env node

/**
 * Main CLI entry point for the Sentry MCP server.
 *
 * Handles command-line argument parsing, environment configuration, Sentry
 * initialization, and starts the MCP server with stdio transport. Requires
 * a Sentry access token and optionally accepts host and DSN configuration.
 *
 * @example CLI Usage
 * ```bash
 * npx @sentry/mcp-server --access-token=TOKEN --host=sentry.io
 * npx @sentry/mcp-server --access-token=TOKEN --url=https://sentry.example.com
 * ```
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "./transports/stdio";
import * as Sentry from "@sentry/node";
import { LIB_VERSION } from "./version";
import {
  validateSentryHost,
  validateAndParseSentryUrl,
} from "./utils/url-utils";

let accessToken: string | undefined = process.env.SENTRY_ACCESS_TOKEN;
let sentryHost = "sentry.io"; // Default hostname
let mcpUrl: string | undefined =
  process.env.MCP_URL || "https://mcp.sentry.dev";
let sentryDsn: string | undefined =
  process.env.SENTRY_DSN || process.env.DEFAULT_SENTRY_DSN;

// Set initial host from environment variables (SENTRY_URL takes precedence)
if (process.env.SENTRY_URL) {
  sentryHost = validateAndParseSentryUrl(process.env.SENTRY_URL);
} else if (process.env.SENTRY_HOST) {
  validateSentryHost(process.env.SENTRY_HOST);
  sentryHost = process.env.SENTRY_HOST;
}

const packageName = "@sentry/mcp-server";

function getUsage(): string {
  return `Usage: ${packageName} --access-token=<token> [--host=<host>|--url=<url>] [--mcp-url=<url>] [--sentry-dsn=<dsn>]`;
}

for (const arg of process.argv.slice(2)) {
  if (arg === "--version" || arg === "-v") {
    console.log(`${packageName} ${LIB_VERSION}`);
    process.exit(0);
  }
  if (arg.startsWith("--access-token=")) {
    accessToken = arg.split("=")[1];
  } else if (arg.startsWith("--host=")) {
    sentryHost = arg.split("=")[1];
    validateSentryHost(sentryHost);
  } else if (arg.startsWith("--url=")) {
    const url = arg.split("=")[1];
    sentryHost = validateAndParseSentryUrl(url);
  } else if (arg.startsWith("--mcp-url=")) {
    mcpUrl = arg.split("=")[1];
  } else if (arg.startsWith("--sentry-dsn=")) {
    sentryDsn = arg.split("=")[1];
  } else {
    console.error("Error: Invalid argument:", arg);
    console.error(getUsage());
    process.exit(1);
  }
}

// Use the hostname directly (always HTTPS)
const host = sentryHost;

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
      "mcp.mcp-url": mcpUrl,
    },
  },
  release: process.env.SENTRY_RELEASE,
  integrations: [
    Sentry.consoleLoggingIntegration(),
    Sentry.zodErrorsIntegration(),
    Sentry.vercelAIIntegration({
      recordInputs: true,
      recordOutputs: true,
    }),
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
  sentryHost: host,
  mcpUrl,
  userAgent: process.env.MCP_USER_AGENT || `sentry-mcp-stdio/${LIB_VERSION}`,
}).catch((err) => {
  console.error("Server error:", err);
  // ensure we've flushed all events
  Sentry.flush(SENTRY_TIMEOUT);
  process.exit(1);
});

// ensure we've flushed all events
Sentry.flush(SENTRY_TIMEOUT);
