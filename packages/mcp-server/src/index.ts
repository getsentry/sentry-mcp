#!/usr/bin/env node

/**
 * Main CLI entry point for the Sentry MCP server.
 *
 * Handles command-line argument parsing, environment configuration, Sentry
 * initialization, and starts the MCP server with stdio transport. Supports
 * device code authentication for sentry.io when no access token is provided.
 *
 * Subcommands:
 *   auth [login]   — Force device code authentication
 *   auth logout    — Clear cached authentication
 *   auth status    — Show current authentication state
 *
 * @example CLI Usage
 * ```bash
 * npx @sentry/mcp-server --access-token=TOKEN --host=sentry.io
 * npx @sentry/mcp-server auth login
 * npx @sentry/mcp-server auth logout
 * ```
 */

import { buildServer } from "@sentry/mcp-core/server";
import { startStdio } from "./transports/stdio";
import * as Sentry from "@sentry/node";
import { LIB_VERSION } from "@sentry/mcp-core/version";
import { buildUsage } from "./cli/usage";
import { parseArgv, parseEnv, merge } from "./cli/parse";
import { finalize } from "./cli/resolve";
import { resolveAccessToken } from "./auth/resolve-token";
import { authCommand } from "./cli/commands/auth";
import { sentryBeforeSend } from "@sentry/mcp-core/telem/sentry";
import { SKILLS } from "@sentry/mcp-core/skills";
import {
  getAgentProvider,
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

async function main() {
  const rawArgs = process.argv.slice(2);

  // Handle subcommands before normal server parsing
  if (rawArgs[0] === "auth") {
    await authCommand(rawArgs.slice(1));
    return;
  }

  const cli = parseArgv(rawArgs);
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
  const partialCfg = (() => {
    try {
      return finalize(merge(cli, env));
    } catch (err) {
      die(err instanceof Error ? err.message : String(err));
    }
  })();

  // Resolve access token before starting the transport.
  // For sentry.io without a token, this blocks on device code flow —
  // the client won't connect until the user has authenticated.
  const cfg = await resolveAccessToken(partialCfg).catch((err) => {
    die(err instanceof Error ? err.message : String(err));
  });

  // Configure embedded agent provider
  if (cfg.agentProvider) {
    setAgentProvider(
      cfg.agentProvider as Parameters<typeof setAgentProvider>[0],
    );
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

  function getConfiguredProvider(): string | undefined {
    return (
      cfg.agentProvider || process.env.EMBEDDED_AGENT_PROVIDER?.toLowerCase()
    );
  }

  function hasProviderMismatch(): {
    mismatch: boolean;
    configured?: string;
    availableKey?: string;
  } {
    const configured = getConfiguredProvider();
    if (!configured) return { mismatch: false };

    const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

    // Check if configured provider's key is missing but other key is present
    if (
      (configured === "openai" || configured === "azure-openai") &&
      !hasOpenAI &&
      hasAnthropic
    ) {
      return {
        mismatch: true,
        configured,
        availableKey: "ANTHROPIC_API_KEY",
      };
    }
    if (configured === "anthropic" && !hasAnthropic && hasOpenAI) {
      return {
        mismatch: true,
        configured: "anthropic",
        availableKey: "OPENAI_API_KEY",
      };
    }

    return { mismatch: false };
  }

  function getProviderSource(): string {
    // Check CLI flag first (cli.agentProvider is only set by --agent-provider flag)
    if (cli.agentProvider) return "explicitly configured";
    // Then check env var (process.env takes precedence over cfg since cfg merges both)
    if (process.env.EMBEDDED_AGENT_PROVIDER)
      return "from EMBEDDED_AGENT_PROVIDER";
    return "auto-detected";
  }

  // Check for LLM API keys and warn if none available
  const resolvedProvider = getResolvedProviderType() as
    | "openai"
    | "azure-openai"
    | "anthropic"
    | undefined;

  if (!resolvedProvider) {
    const mismatchInfo = hasProviderMismatch();
    let providerConfigError: string | undefined;
    try {
      getAgentProvider();
    } catch (error) {
      providerConfigError =
        error instanceof Error ? error.message : String(error);
    }

    if (hasProviderConflict()) {
      console.warn(
        "Warning: Both ANTHROPIC_API_KEY and OPENAI_API_KEY are set, but no provider is explicitly configured.",
      );
      console.warn(
        "Please set EMBEDDED_AGENT_PROVIDER='openai', 'azure-openai', or 'anthropic' to specify which provider to use.",
      );
      console.warn(
        "AI-powered search tools will be unavailable until a provider is selected.",
      );
    } else if (mismatchInfo.mismatch) {
      const expectedKey =
        mismatchInfo.configured === "openai" ||
        mismatchInfo.configured === "azure-openai"
          ? "OPENAI_API_KEY"
          : "ANTHROPIC_API_KEY";
      const configuredViaCliFlag = Boolean(cli.agentProvider);
      const providerSetting = configuredViaCliFlag
        ? `--agent-provider=${mismatchInfo.configured}`
        : `EMBEDDED_AGENT_PROVIDER='${mismatchInfo.configured}'`;
      const changeProviderHint = configuredViaCliFlag
        ? "Change --agent-provider to match your available API key"
        : "Change EMBEDDED_AGENT_PROVIDER to match your available API key";
      console.warn(
        `Warning: ${providerSetting} but ${expectedKey} is not set.`,
      );
      console.warn(`Found ${mismatchInfo.availableKey} instead. Either:`);
      console.warn(
        `  - Set ${expectedKey} to use the ${mismatchInfo.configured} provider, or`,
      );
      console.warn(`  - ${changeProviderHint}`);
      console.warn(
        "AI-powered search tools will be unavailable until this is resolved.",
      );
    } else if (
      providerConfigError &&
      !providerConfigError.startsWith("No embedded agent provider configured")
    ) {
      console.warn(`Warning: ${providerConfigError}`);
      console.warn(
        "AI-powered search tools will be unavailable until this is resolved.",
      );
    } else {
      console.warn(
        "Warning: No LLM API key found (OPENAI_API_KEY or ANTHROPIC_API_KEY).",
      );
      console.warn(
        "The following AI-powered search tools will be unavailable:",
      );
      console.warn(
        "  - search_events, search_issues, search_issue_events, use_sentry",
      );
      console.warn(
        "Use list_issues and list_events for direct Sentry query syntax instead.",
      );
    }
    console.warn("");
  } else {
    const providerSource = getProviderSource();
    const providerLabel = getAgentProvider().label;
    console.warn(
      `Using ${providerLabel} for AI-powered search tools (${providerSource}).`,
    );
    // Warn about auto-detection deprecation
    if (providerSource === "auto-detected") {
      console.warn(
        "Deprecation warning: Auto-detection of LLM provider is deprecated.",
      );
      console.warn(
        `Please set EMBEDDED_AGENT_PROVIDER='${resolvedProvider}' explicitly.`,
      );
      console.warn("Auto-detection will be removed in a future release.");
    }
    console.warn("");
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
        "mcp.experimental_mode": cli.experimental ? "true" : "false",
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

  // Log experimental mode status
  if (cli.experimental) {
    console.warn(
      "Experimental mode enabled: Forward-looking tool variants and experimental features are available.",
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
    agentMode: cli.agent,
    experimentalMode: cli.experimental,
    transport: "stdio" as const,
  };

  // Build server with context to filter tools based on granted skills
  // Use agentMode when --agent flag is set (only exposes use_sentry tool)
  // Use experimentalMode when --experimental flag is set (enables forward-looking variants)
  const server = buildServer({
    context,
    agentMode: cli.agent,
    experimentalMode: cli.experimental,
  });

  startStdio(server, context).catch(async (err) => {
    console.error("Server error:", err);
    Sentry.captureException(err);
    await Sentry.flush(SENTRY_TIMEOUT);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
