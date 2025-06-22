#!/usr/bin/env node

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { config } from "dotenv";
import chalk from "chalk";
import { connectToMCPServer } from "./mcp-client.js";
import { connectToRemoteMCPServer } from "./mcp-client-remote.js";
import { runAgent } from "./agent.js";
import { DEFAULT_MODEL } from "./constants.js";
import { logError, logInfo, logUser } from "./logger.js";
import type { MCPConnection } from "./types.js";

// Load environment variables from multiple possible locations
config(); // Try current directory first
config({ path: "../../.env" }); // Also try root directory

const program = new Command();

// OAuth support for MCP server (not Sentry directly)

program
  .name("mcp-client")
  .description("CLI tool to test Sentry MCP server")
  .version("0.0.1")
  .argument("[prompt]", "Prompt to send to the AI agent")
  .option("-m, --model <model>", "Override the AI model to use")
  .option("--access-token <token>", "Sentry access token")
  .option(
    "--mcp-host <host>",
    "MCP server host",
    process.env.MCP_HOST || "https://mcp.sentry.dev",
  )
  .option("--local", "Use local stdio transport instead of HTTP")
  .action(async (prompt, options) => {
    try {
      // Check for access token in priority order
      const accessToken =
        options.accessToken || process.env.SENTRY_ACCESS_TOKEN;
      const sentryHost = process.env.SENTRY_HOST;

      const anthropicKey = process.env.ANTHROPIC_API_KEY;

      // Only require Sentry access token for local mode
      if (options.local && !accessToken) {
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

      if (!anthropicKey) {
        logError("ANTHROPIC_API_KEY environment variable is required");
        console.log(
          chalk.yellow("\nPlease set it in your .env file or environment:"),
        );
        console.log(chalk.gray("ANTHROPIC_API_KEY=your_anthropic_api_key"));
        process.exit(1);
      }

      // Connect to MCP server
      let connection: MCPConnection;
      if (options.local) {
        // Use local stdio transport
        connection = await connectToMCPServer({
          accessToken,
          host: sentryHost || process.env.SENTRY_HOST,
        });
      } else {
        // Use remote SSE transport
        connection = await connectToRemoteMCPServer({
          mcpHost: options.mcpHost,
          accessToken: accessToken,
        });
      }

      const agentConfig = {
        model: options.model,
      };

      try {
        if (prompt) {
          // Single prompt mode
          logUser(prompt);
          await runAgent(connection, prompt, agentConfig);
        } else {
          // Interactive mode (default when no prompt provided)
          logInfo("Interactive mode - type 'exit', 'quit', or Ctrl+D to end");

          const rl = readline.createInterface({ input, output });

          while (true) {
            try {
              const userInput = await rl.question(chalk.cyan("You> "));

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
                logUser(userInput);
                await runAgent(connection, userInput, agentConfig);
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
      }
    } catch (error) {
      logError("Fatal error", error instanceof Error ? error : String(error));
      process.exit(1);
    }
  });

// Handle uncaught errors
process.on("unhandledRejection", (error) => {
  logError("Unhandled error", error instanceof Error ? error : String(error));
  process.exit(1);
});

program.parse(process.argv);
