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
 * ```
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "./transports/stdio";
import * as Sentry from "@sentry/node";
import { LIB_VERSION } from "./version";
import { normalizeHost, extractHostname } from "./utils/url-utils";

let accessToken: string | undefined = process.env.SENTRY_ACCESS_TOKEN;
let sentryHostOrUrl: string = process.env.SENTRY_HOST || "sentry.io";
let mcpUrl: string | undefined =
  process.env.MCP_URL || "https://mcp.sentry.dev";
let sentryDsn: string | undefined =
  process.env.SENTRY_DSN || process.env.DEFAULT_SENTRY_DSN;

// Parse SENTRY_HOST to extract hostname and protocol
function parseSentryHost(hostOrUrl: string): {
  host: string;
  protocol: string;
} {
  try {
    const normalizedUrl = normalizeHost(hostOrUrl);
    const url = new URL(normalizedUrl);
    return {
      host: url.host,
      protocol: url.protocol.replace(":", ""),
    };
  } catch (error) {
    // Fallback for invalid URLs - assume it's just a hostname
    return {
      host: hostOrUrl,
      protocol: "https",
    };
  }
}

const packageName = "@sentry/mcp-server";

function getUsage() {
  return `Usage: ${packageName} --access-token=<token> [--host=<host>] [--mcp-url=<url>] [--sentry-dsn=<dsn>]`;
}

for (const arg of process.argv.slice(2)) {
  if (arg === "--version" || arg === "-v") {
    console.log(`${packageName} ${LIB_VERSION}`);
    process.exit(0);
  }
  if (arg.startsWith("--access-token=")) {
    accessToken = arg.split("=")[1];
  } else if (arg.startsWith("--host=")) {
    sentryHostOrUrl = arg.split("=")[1];
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

// Parse the final host value after processing command line args
const { host, protocol } = parseSentryHost(sentryHostOrUrl);

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
  sentryProtocol: protocol,
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
