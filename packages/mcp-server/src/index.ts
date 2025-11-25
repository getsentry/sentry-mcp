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
import { ALL_SCOPES } from "@sentry/mcp-core/permissions";
import { DEFAULT_SCOPES, DEFAULT_SKILLS } from "@sentry/mcp-core/constants";
import { SKILLS } from "@sentry/mcp-core/skills";
import { setOpenAIBaseUrl } from "@sentry/mcp-core/internal/agents/openai-provider";

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

(async () => {
  const env = parseEnv(process.env);
  const merged = merge(cli, env);
  let cfg = (() => {
    try {
      return finalize(merged);
    } catch (err) {
      die(err instanceof Error ? err.message : String(err));
    }
  })();

  // OAuth flow integration
  // If no access token is provided, attempt OAuth authentication
  if (!cfg.accessToken) {
    // Check if OAuth can be used
    const canUseOAuth = !merged.host && !merged.url;

    if (!canUseOAuth) {
      // Custom host requires access token
      die(
        "Error: Access token is required when using a custom Sentry host.\n\n" +
          "OAuth authentication is only available for the default Sentry host (sentry.io).\n" +
          "For self-hosted Sentry instances, please provide an access token:\n\n" +
          "  --access-token=YOUR_TOKEN\n" +
          "  or set SENTRY_ACCESS_TOKEN environment variable",
      );
    }

    // OAuth is available - proceed with authentication
    const mcpProxyUrl = cfg.mcpUrl || "https://mcp.sentry.dev";

    // Handle --reauth flag
    if (merged.reauth) {
      console.error("Clearing cached OAuth tokens...\n");
      const { ConfigManager } = await import("./auth/config.js");
      const configManager = new ConfigManager();
      await configManager.clearAllTokens();
    }

    // Perform OAuth flow
    console.error(
      "No access token provided. Starting OAuth authentication...\n",
    );
    try {
      const { OAuthClient } = await import("./auth/oauth.js");
      const oauthClient = new OAuthClient({ mcpHost: mcpProxyUrl });
      const accessToken = await oauthClient.getAccessToken();

      // Update config with obtained token
      cfg = {
        ...cfg,
        accessToken,
      };
    } catch (error) {
      die(
        `OAuth authentication failed: ${error instanceof Error ? error.message : String(error)}\n\nIf you continue to have issues, you can provide an access token directly:\n  --access-token=YOUR_TOKEN`,
      );
    }
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

  // At this point, accessToken must be defined (either provided or obtained via OAuth)
  if (!cfg.accessToken) {
    die("Error: No access token available. This should not happen.");
  }

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
  // Use agentMode when --agent flag is set (only exposes use_sentry tool)
  const server = buildServer({
    context,
    agentMode: cli.agent,
  });

  await startStdio(server, context).catch((err) => {
    console.error("Server error:", err);
    // ensure we've flushed all events
    Sentry.flush(SENTRY_TIMEOUT);
    process.exit(1);
  });

  // ensure we've flushed all events
  Sentry.flush(SENTRY_TIMEOUT);
})();
