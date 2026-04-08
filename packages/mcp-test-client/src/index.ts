#!/usr/bin/env node

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command, Option } from "commander";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import * as Sentry from "@sentry/node";
import { connectToMCPServer } from "./mcp-test-client.js";
import { connectToRemoteMCPServer } from "./mcp-test-client-remote.js";
import { runAgent } from "./agent.js";
import { logError, logInfo } from "./logger.js";
import { sentryBeforeSend } from "@sentry/mcp-core/telem/sentry";
import type { MCPConnection } from "./types.js";
import { resolveTransportMode } from "./transport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../../");

// Load environment variables from multiple possible locations
// IMPORTANT: Do NOT use override:true as it would overwrite shell/CI environment variables
config(); // Try current directory first (.env in mcp-test-client)
config({ path: path.join(rootDir, ".env") }); // Also try root directory (fallback for shared values)

const program = new Command();

// OAuth support for MCP server (not Sentry directly)

program
  .name("mcp-test-client")
  .description("CLI tool to test Sentry MCP server")
  .version("0.0.1")
  .argument("[prompt]", "Prompt to send to the AI agent")
  .option("-m, --model <model>", "Override the AI model to use")
  .option("--access-token <token>", "Sentry access token")
  .addOption(
    new Option(
      "--transport <transport>",
      "Transport to use: auto, stdio, or http",
    )
      .choices(["auto", "stdio", "http"])
      .default("auto"),
  )
  .option(
    "--mcp-host <host>",
    "MCP server host",
    process.env.MCP_URL || "http://localhost:5173",
  )
  .option("--host <host>", "Sentry host for stdio transport")
  .option("--sentry-dsn <dsn>", "Sentry DSN for error reporting")
  .option(
    "--agent",
    "Use agent mode (/mcp?agent=1) instead of standard mode (for use_sentry tool)",
  )
  .option("--experimental", "Enable experimental tools (/mcp?experimental=1)")
  .option(
    "--list-tools",
    "Connect to the MCP server, list available tools, and exit without using an LLM",
  )
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
        beforeSend: sentryBeforeSend,
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
      const sentryHost = options.host || process.env.SENTRY_HOST;

      const openaiKey = process.env.OPENAI_API_KEY;
      const transport = resolveTransportMode({
        requestedTransport: options.transport,
        accessToken,
      });
      const listToolsOnly = Boolean(options.listTools);

      if (!listToolsOnly && !openaiKey) {
        logError("OPENAI_API_KEY environment variable is required");
        console.log(
          chalk.yellow("\nPlease set it in your .env file or environment:"),
        );
        console.log(chalk.gray("OPENAI_API_KEY=your_openai_api_key"));
        process.exit(1);
      }

      // Connect to MCP server
      let connection: MCPConnection;
      if (transport === "stdio") {
        connection = await connectToMCPServer({
          accessToken,
          host: sentryHost,
          sentryDsn: sentryDsn,
          useAgentEndpoint: options.agent,
          useExperimental: options.experimental,
        });
      } else {
        connection = await connectToRemoteMCPServer({
          mcpHost: options.mcpHost,
          accessToken,
          useAgentEndpoint: options.agent,
          useExperimental: options.experimental,
        });
      }

      // Set conversation ID as a global tag for all traces
      Sentry.setTag("gen_ai.conversation.id", connection.sessionId);

      const agentConfig = {
        model: options.model,
      };

      try {
        if (listToolsOnly) {
          const toolNames = Array.from(connection.tools.keys()).sort();
          logInfo("Available tools", `${toolNames.length} tools`);
          for (const toolName of toolNames) {
            console.log(chalk.gray(`  - ${toolName}`));
          }
        } else if (prompt) {
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
