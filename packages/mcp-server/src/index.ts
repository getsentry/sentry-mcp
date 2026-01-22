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

import { buildServer } from "@sentry/mcp-core/server";
import { startStdio } from "./transports/stdio";
import * as Sentry from "@sentry/node";
import { LIB_VERSION } from "@sentry/mcp-core/version";
import { buildUsage } from "./cli/usage";
import { parseArgv, parseEnv, merge } from "./cli/parse";
import { finalize } from "./cli/resolve";
import { sentryBeforeSend } from "@sentry/mcp-core/telem/sentry";
import { SKILLS } from "@sentry/mcp-core/skills";
import {
  setAgentProvider,
  setProviderBaseUrls,
  getResolvedProviderType,
} from "@sentry/mcp-core/internal/agents/provider-factory";

const packageName = "@sentry/mcp-server";
const allSkills = Object.keys(SKILLS) as ReadonlyArray<
  (typeof SKILLS)[keyof typeof SKILLS]["id"]
>;
const usageText = buildUsage(packageName, allSkills);

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

// Configure embedded agent provider
if (cfg.agentProvider) {
  setAgentProvider(cfg.agentProvider);
}
setProviderBaseUrls({
  openaiBaseUrl: cfg.openaiBaseUrl,
  anthropicBaseUrl: cfg.anthropicBaseUrl,
});
if (cfg.openaiModel) {
  process.env.OPENAI_MODEL = cfg.openaiModel;
}
if (cfg.anthropicModel) {
  process.env.ANTHROPIC_MODEL = cfg.anthropicModel;
}

// Helper functions for provider status messages
function hasProviderConflict(): boolean {
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasExplicitProvider =
    cfg.agentProvider || process.env.EMBEDDED_AGENT_PROVIDER;
  return hasAnthropic && hasOpenAI && !hasExplicitProvider;
}

function getProviderSource(): string {
  if (cfg.agentProvider) return "explicitly configured";
  if (process.env.EMBEDDED_AGENT_PROVIDER)
    return "from EMBEDDED_AGENT_PROVIDER";
  return "auto-detected";
}

// Check for LLM API keys and warn if none available
const resolvedProvider = getResolvedProviderType();

if (!resolvedProvider) {
  if (hasProviderConflict()) {
    console.warn(
      "Warning: Both ANTHROPIC_API_KEY and OPENAI_API_KEY are set, but no provider is explicitly configured.",
    );
    console.warn(
      "Please set EMBEDDED_AGENT_PROVIDER='openai' or 'anthropic' to specify which provider to use.",
    );
    console.warn(
      "AI-powered search tools will be unavailable until a provider is selected.",
    );
  } else {
    console.warn(
      "Warning: No LLM API key found (OPENAI_API_KEY or ANTHROPIC_API_KEY).",
    );
    console.warn("The following AI-powered search tools will be unavailable:");
    console.warn(
      "  - search_events, search_issues, search_issue_events, use_sentry",
    );
    console.warn(
      "Use list_issues and list_events for direct Sentry query syntax instead.",
    );
  }
  console.warn("");
} else {
  console.warn(
    `Using ${resolvedProvider} for AI-powered search tools (${getProviderSource()}).`,
  );
  if (hasProviderConflict()) {
    console.warn(
      "Note: Both API keys detected. Consider setting EMBEDDED_AGENT_PROVIDER to avoid conflicts.",
    );
  }
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

// Graceful shutdown handlers
async function shutdown(signal: string) {
  console.error(`${signal} received, shutting down...`);
  await Sentry.flush(SENTRY_TIMEOUT);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Uncaught error handlers
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  Sentry.captureException(error);
  await Sentry.flush(SENTRY_TIMEOUT);
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  console.error("Unhandled rejection:", reason);
  Sentry.captureException(reason);
  await Sentry.flush(SENTRY_TIMEOUT);
  process.exit(1);
});

// Build context once for server configuration and runtime
const context = {
  accessToken: cfg.accessToken,
  grantedSkills: cfg.finalSkills,
  constraints: {
    organizationSlug: cfg.organizationSlug ?? null,
    projectSlug: cfg.projectSlug ?? null,
  },
  sentryHost: cfg.sentryHost,
  mcpUrl: cfg.mcpUrl,
  openaiBaseUrl: cfg.openaiBaseUrl,
};

// Build server with context to filter tools based on granted skills
// Use agentMode when --agent flag is set (only exposes use_sentry tool)
const server = buildServer({
  context,
  agentMode: cli.agent,
});

startStdio(server, context).catch(async (err) => {
  console.error("Server error:", err);
  Sentry.captureException(err);
  await Sentry.flush(SENTRY_TIMEOUT);
  process.exit(1);
});
