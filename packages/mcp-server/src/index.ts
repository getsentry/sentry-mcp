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

import { buildServer } from "./server";
import { startStdio } from "./transports/stdio";
import * as Sentry from "@sentry/node";
import { LIB_VERSION } from "./version";
import { buildUsage } from "./cli/usage";
import { parseArgv, parseEnv, merge } from "./cli/parse";
import { finalize } from "./cli/resolve";
import { sentryBeforeSend } from "./telem/sentry";
import { ALL_SCOPES } from "./permissions";
import { DEFAULT_SCOPES, DEFAULT_SKILLS } from "./constants";
import { SKILLS } from "./skills";
import { setOpenAIBaseUrl } from "./internal/agents/openai-provider";
import agentTools from "./tools/agent-tools";

const packageName = "@sentry/mcp-server";
const allSkills = Object.keys(SKILLS) as ReadonlyArray<
  (typeof SKILLS)[keyof typeof SKILLS]["id"]
>;
const usageText = buildUsage(
  packageName,
  DEFAULT_SCOPES,
  ALL_SCOPES,
  DEFAULT_SKILLS,
  allSkills,
);

function die(message: string): never {
  console.error(message);
  console.error(usageText);
  process.exit(1);
}
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
const cfg = (() => {
  try {
    return finalize(merge(cli, env));
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
})();

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

// Configure OpenAI settings from CLI flags
// Note: baseUrl can only be set via CLI flag, not env var (security: prevents credential theft)
setOpenAIBaseUrl(cfg.openaiBaseUrl);
if (cfg.openaiModel) {
  process.env.OPENAI_MODEL = cfg.openaiModel;
}

Sentry.init({
  dsn: cfg.sentryDsn,
  sendDefaultPii: true,
  tracesSampleRate: 1,
  beforeSend: sentryBeforeSend,
  initialScope: {
    tags: {
      "mcp.server_version": LIB_VERSION,
      "mcp.transport": "stdio",
      "mcp.agent_mode": cli.agent ? "true" : "false",
      "sentry.host": cfg.sentryHost,
      "mcp.mcp-url": cfg.mcpUrl,
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

// Log agent mode status
if (cli.agent) {
  console.warn("Agent mode enabled: Only use_sentry tool is available.");
  console.warn(
    "The use_sentry tool provides access to all Sentry operations through natural language.",
  );
  console.warn("");
}

const SENTRY_TIMEOUT = 5000; // 5 seconds

// Build context once for server configuration and runtime
const context = {
  accessToken: cfg.accessToken,
  grantedScopes: cfg.finalScopes,
  grantedSkills: cfg.finalSkills,
  constraints: {
    organizationSlug: cfg.organizationSlug ?? null,
    projectSlug: cfg.projectSlug ?? null,
  },
  sentryHost: cfg.sentryHost,
  mcpUrl: cfg.mcpUrl,
  openaiBaseUrl: cfg.openaiBaseUrl,
};

// Build server with context to filter tools based on granted scopes
// Use agentTools when --agent flag is set (only exposes use_sentry tool)
const server = buildServer({
  context,
  tools: cli.agent ? agentTools : undefined,
});

startStdio(server, context).catch((err) => {
  console.error("Server error:", err);
  // ensure we've flushed all events
  Sentry.flush(SENTRY_TIMEOUT);
  process.exit(1);
});

// ensure we've flushed all events
Sentry.flush(SENTRY_TIMEOUT);
