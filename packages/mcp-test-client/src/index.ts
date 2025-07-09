#!/usr/bin/env node

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { config } from "dotenv";
import chalk from "chalk";
import * as Sentry from "@sentry/node";
import { connectToMCPServer } from "./mcp-test-client.js";
import { connectToRemoteMCPServer } from "./mcp-test-client-remote.js";
import { runAgent } from "./agent.js";
import { DEFAULT_MODEL } from "./constants.js";
import { logError, logInfo, logSuccess, logUser } from "./logger.js";
import { LIB_VERSION } from "./version.js";
import type { MCPConnection } from "./types.js";

// Load environment variables from multiple possible locations
config(); // Try current directory first
config({ path: "../../.env" }); // Also try root directory

const program = new Command();

// OAuth support for MCP server (not Sentry directly)

program
  .name("mcp-test-client")
  .description("CLI tool to test Sentry MCP server")
  .version("0.0.1")
  .argument("[prompt]", "Prompt to send to the AI agent")
  .option("-m, --model <model>", "Override the AI model to use")
  .option("--access-token <token>", "Sentry access token")
  .option(
    "--mcp-host <host>",
    "MCP server host",
    process.env.MCP_URL || "https://mcp.sentry.dev",
  )
  .option("--sentry-dsn <dsn>", "Sentry DSN for error reporting")
  .action(async (prompt, options) => {
    try {
      // Initialize Sentry with CLI-provided DSN if available
      const sentryDsn =
        options.sentryDsn ||
        process.env.SENTRY_DSN ||
        process.env.DEFAULT_SENTRY_DSN;

      Sentry.init({
        dsn: sentryDsn,
        sendDefaultPii: true,
        tracesSampleRate: 1,
        initialScope: {
          tags: {
            "gen_ai.agent.name": "sentry-mcp-agent",
            "gen_ai.system": "openai",
          },
        },
        release: process.env.SENTRY_RELEASE,
        integrations: [
          Sentry.consoleIntegration(),
          Sentry.zodErrorsIntegration(),
          Sentry.vercelAIIntegration({
            recordInputs: true,
            recordOutputs: true,
          }),
        ],
        environment:
          process.env.SENTRY_ENVIRONMENT ??
          (process.env.NODE_ENV !== "production"
            ? "development"
            : "production"),
      });

      // Check for access token in priority order
      const accessToken =
        options.accessToken || process.env.SENTRY_ACCESS_TOKEN;
      const sentryHost = process.env.SENTRY_HOST;

      const openaiKey = process.env.OPENAI_API_KEY;

      // Determine mode based on access token availability
      const useLocalMode = !!accessToken;

      // Only require Sentry access token for local mode
      if (useLocalMode && !accessToken) {
        logError("No Sentry access token found");
        console.log(chalk.yellow("To authenticate with Sentry:\n"));
        console.log(chalk.gray("1. Use an access token:"));
        console.log(
          chalk.gray("   - Set SENTRY_ACCESS_TOKEN environment variable"),
        );
        console.log(chalk.gray("   - Add it to your .env file"));
        console.log(chalk.gray("   - Or use --access-token flag\n"));
        console.log(chalk.gray("2. Get an access token from:"));
        console.log(
          chalk.gray(
            "   https://sentry.io/settings/account/api/auth-tokens/\n",
          ),
        );
        console.log(
          chalk.gray(
            "Required scopes: org:read, project:read, project:write, team:read, team:write, event:write\n",
          ),
        );
        process.exit(1);
      }

      if (!openaiKey) {
        logError("OPENAI_API_KEY environment variable is required");
        console.log(
          chalk.yellow("\nPlease set it in your .env file or environment:"),
        );
        console.log(chalk.gray("OPENAI_API_KEY=your_openai_api_key"));
        process.exit(1);
      }

      // Connect to MCP server
      let connection: MCPConnection;
      if (useLocalMode) {
        // Use local stdio transport when access token is provided
        connection = await connectToMCPServer({
          accessToken,
          host: sentryHost || process.env.SENTRY_HOST,
          sentryDsn: sentryDsn,
        });
      } else {
        // Use remote SSE transport when no access token
        connection = await connectToRemoteMCPServer({
          mcpHost: options.mcpHost,
          accessToken: accessToken,
        });
      }

      // Set conversation ID as a global tag for all traces
      Sentry.setTag("gen_ai.conversation.id", connection.sessionId);

      const agentConfig = {
        model: options.model,
      };

      try {
        if (prompt) {
          // Single prompt mode
          await runAgent(connection, prompt, agentConfig);
        } else {
          // Interactive mode (default when no prompt provided)
          logInfo("Interactive mode", "type 'exit', 'quit', or Ctrl+D to end");
          console.log(); // Add extra newline after startup message

          const rl = readline.createInterface({ input, output });

          while (true) {
            try {
              const userInput = await rl.question(chalk.gray("> "));

              // Handle null input (Ctrl+D / EOF)
              if (userInput === null) {
                logInfo("Goodbye!");
                break;
              }

              if (
                userInput.toLowerCase() === "exit" ||
                userInput.toLowerCase() === "quit"
              ) {
                logInfo("Goodbye!");
                break;
              }

              if (userInput.trim()) {
                await runAgent(connection, userInput, agentConfig);
                // Add newline after response before next prompt
                console.log();
              }
            } catch (error) {
              // Handle EOF (Ctrl+D) which may throw an error
              if (
                (error as any).code === "ERR_USE_AFTER_CLOSE" ||
                (error instanceof Error && error.message?.includes("EOF"))
              ) {
                logInfo("Goodbye!");
                break;
              }
              throw error;
            }
          }

          rl.close();
        }
      } finally {
        // Always disconnect
        await connection.disconnect();
        // Ensure Sentry events are flushed
        await Sentry.flush(5000);
      }
    } catch (error) {
      const eventId = Sentry.captureException(error);
      logError(
        "Fatal error",
        `${error instanceof Error ? error.message : String(error)}. Event ID: ${eventId}`,
      );
      // Ensure Sentry events are flushed before exit
      await Sentry.flush(5000);
      process.exit(1);
    }
  });

// Handle uncaught errors
process.on("unhandledRejection", async (error) => {
  const eventId = Sentry.captureException(error);
  logError(
    "Unhandled error",
    `${error instanceof Error ? error.message : String(error)}. Event ID: ${eventId}`,
  );
  // Ensure Sentry events are flushed before exit
  await Sentry.flush(5000);
  process.exit(1);
});

program.parse(process.argv);
