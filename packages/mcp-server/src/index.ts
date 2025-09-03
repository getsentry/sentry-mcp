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
import { sentryBeforeSend } from "./internal/sentry-scrubbing";
import {
  type Scope,
  ALL_SCOPES,
  validateScopesStrictFromString,
  resolveScopes,
} from "./permissions";
import { DEFAULT_SCOPES } from "./constants";

let accessToken: string | undefined = process.env.SENTRY_ACCESS_TOKEN;
let sentryHost = "sentry.io"; // Default hostname
let mcpUrl: string | undefined =
  process.env.MCP_URL || "https://mcp.sentry.dev";
let sentryDsn: string | undefined =
  process.env.SENTRY_DSN || process.env.DEFAULT_SENTRY_DSN;
let grantedScopes: Set<Scope> | undefined = undefined;
let additionalScopes: Set<Scope> | undefined = undefined;

// Set initial host from environment variables (SENTRY_URL takes precedence)
if (process.env.SENTRY_URL) {
  sentryHost = validateAndParseSentryUrl(process.env.SENTRY_URL);
} else if (process.env.SENTRY_HOST) {
  validateSentryHost(process.env.SENTRY_HOST);
  sentryHost = process.env.SENTRY_HOST;
}

const packageName = "@sentry/mcp-server";

function getUsage(): string {
  return `Usage: ${packageName} --access-token=<token> [--host=<host>|--url=<url>] [--mcp-url=<url>] [--sentry-dsn=<dsn>] [--scopes=<scope1,scope2>] [--add-scopes=<scope1,scope2>] [--all-scopes]

Default scopes (read-only):
  - org:read, project:read, team:read, event:read

Scope options:
  --scopes      Override default scopes completely
  --add-scopes  Add scopes to the default read-only set
  --all-scopes  Grant all available scopes (admin-level and implied)

Available scopes (higher scopes include lower):
  - org:read, org:write, org:admin
  - project:read, project:write, project:admin
  - team:read, team:write, team:admin
  - member:read, member:write, member:admin
  - event:read, event:write, event:admin
  - project:releases

Examples:
  # Default read-only access
  ${packageName} --access-token=TOKEN
  
  # Override with specific scopes only
  ${packageName} --access-token=TOKEN --scopes=org:read,event:read
  
  # Add write permissions to defaults
  ${packageName} --access-token=TOKEN --add-scopes=event:write,project:write`;
}

function fmtInvalid(invalid: string[], envName?: string): string {
  const where = envName ? `${envName} provided` : "Invalid scopes provided";
  return `Error: ${where}: ${invalid.join(", ")}\nAvailable scopes: ${ALL_SCOPES.join(", ")}`;
}

for (const arg of process.argv.slice(2)) {
  if (arg === "--help" || arg === "-h") {
    console.log(getUsage());
    process.exit(0);
  }
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
  } else if (arg.startsWith("--scopes=")) {
    const scopesString = arg.split("=")[1];
    const { valid, invalid } = validateScopesStrictFromString(scopesString);
    if (invalid.length > 0) {
      console.error(fmtInvalid(invalid));
      console.error(getUsage());
      process.exit(1);
    }
    grantedScopes = valid;
    if (grantedScopes.size === 0) {
      console.error("Error: Invalid scopes provided. No valid scopes found.");
      console.error(getUsage());
      process.exit(1);
    }
  } else if (arg.startsWith("--add-scopes=")) {
    const scopesString = arg.split("=")[1];
    const { valid, invalid } = validateScopesStrictFromString(scopesString);
    if (invalid.length > 0) {
      console.error(fmtInvalid(invalid));
      console.error(getUsage());
      process.exit(1);
    }
    additionalScopes = valid;
    if (additionalScopes.size === 0) {
      console.error(
        "Error: Invalid additional scopes provided. No valid scopes found.",
      );
      console.error(getUsage());
      process.exit(1);
    }
  } else if (arg === "--all-scopes") {
    // Explicitly grant all available scopes
    grantedScopes = new Set<Scope>(ALL_SCOPES as ReadonlyArray<Scope>);
  } else {
    console.error("Error: Invalid argument:", arg);
    console.error(getUsage());
    process.exit(1);
  }
}

// Environment precedence: Only apply env vars if neither CLI override nor additive flags were provided
if (!grantedScopes && !additionalScopes) {
  if (process.env.MCP_SCOPES) {
    const { valid, invalid } = validateScopesStrictFromString(
      process.env.MCP_SCOPES,
    );
    if (invalid.length > 0) {
      console.error(fmtInvalid(invalid, "MCP_SCOPES"));
      console.error(getUsage());
      process.exit(1);
    }
    if (valid.size === 0) {
      console.error(
        "Error: Invalid MCP_SCOPES provided. No valid scopes found.",
      );
      console.error(getUsage());
      process.exit(1);
    }
    grantedScopes = valid;
  } else if (process.env.MCP_ADD_SCOPES) {
    const { valid, invalid } = validateScopesStrictFromString(
      process.env.MCP_ADD_SCOPES,
    );
    if (invalid.length > 0) {
      console.error(fmtInvalid(invalid, "MCP_ADD_SCOPES"));
      console.error(getUsage());
      process.exit(1);
    }
    if (valid.size === 0) {
      console.error(
        "Error: Invalid MCP_ADD_SCOPES provided. No valid scopes found.",
      );
      console.error(getUsage());
      process.exit(1);
    }
    additionalScopes = valid;
  }
}

if (!accessToken) {
  console.error(
    "Error: No access token was provided. Pass one with `--access-token` or via `SENTRY_ACCESS_TOKEN`.",
  );
  console.error(getUsage());
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
const finalScopes = resolveScopes({
  override: grantedScopes,
  add: additionalScopes,
  defaults: DEFAULT_SCOPES,
});

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
