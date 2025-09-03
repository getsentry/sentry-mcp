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
import { buildUsage } from "./cli/usage";
import { parseArgv, parseEnv, merge } from "./cli/parse";
import { finalize } from "./cli/resolve";
import { sentryBeforeSend } from "./internal/sentry-scrubbing";
import { type Scope, ALL_SCOPES } from "./permissions";
import { DEFAULT_SCOPES } from "./constants";

const packageName = "@sentry/mcp-server";
const usageText = buildUsage(packageName, DEFAULT_SCOPES, ALL_SCOPES);
const cli = parseArgv(process.argv.slice(2));
if (cli.help) {
  console.log(usageText);
  process.exit(0);
}
if (cli.version) {
  console.log(`${packageName} ${LIB_VERSION}`);
  process.exit(0);
}
if (cli.unknownArgs.length > 0) {
  console.error("Error: Invalid argument(s):", cli.unknownArgs.join(", "));
  console.error(usageText);
  process.exit(1);
}

const env = parseEnv(process.env);
let accessToken: string;
let sentryHost: string;
let mcpUrl: string | undefined;
let sentryDsn: string | undefined;
let finalScopes: Set<Scope> | undefined;
try {
  const merged = merge(cli, env);
  const cfg = finalize(merged);
  accessToken = cfg.accessToken;
  sentryHost = cfg.sentryHost;
  mcpUrl = cfg.mcpUrl;
  sentryDsn = cfg.sentryDsn;
  finalScopes = cfg.finalScopes;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  console.error(usageText);
  process.exit(1);
}

// Check for OpenAI API key and warn if missing
if (!process.env.OPENAI_API_KEY) {
  console.warn("Warning: OPENAI_API_KEY environment variable is not set.");
  console.warn("The following AI-powered search tools will be unavailable:");
  console.warn("  - search_events (natural language event search)");
  console.warn("  - search_issues (natural language issue search)");
  console.warn(
    "All other tools will function normally. To enable AI-powered search, set OPENAI_API_KEY.",
  );
  console.warn("");
}

Sentry.init({
  dsn: sentryDsn,
  sendDefaultPii: true,
  tracesSampleRate: 1,
  beforeSend: sentryBeforeSend,
  initialScope: {
    tags: {
      "mcp.server_version": LIB_VERSION,
      "mcp.transport": "stdio",
      "sentry.host": sentryHost,
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

// Process scope configuration using shared resolver
// XXX: we could do what we're doing in routes/auth.ts and pass the context
// identically, but we don't really need userId and userName yet
startStdio(instrumentedServer, {
  accessToken,
  grantedScopes: finalScopes,
  constraints: {
    organizationSlug: null,
  },
  sentryHost,
  mcpUrl,
}).catch((err) => {
  console.error("Server error:", err);
  // ensure we've flushed all events
  Sentry.flush(SENTRY_TIMEOUT);
  process.exit(1);
});

// ensure we've flushed all events
Sentry.flush(SENTRY_TIMEOUT);
