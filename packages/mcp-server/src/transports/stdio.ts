/**
 * Standard I/O Transport for MCP Server.
 *
 * Provides stdio-based communication for the Sentry MCP server, typically used
 * when the server runs as a subprocess communicating via stdin/stdout pipes.
 *
 * @example Basic Usage
 * ```typescript
 * import { Server } from "@modelcontextprotocol/sdk/server/index.js";
 * import { startStdio } from "./transports/stdio.js";
 *
 * const server = new Server();
 * const context = {
 *   accessToken: process.env.SENTRY_TOKEN,
 *   host: "sentry.io"
 * };
 *
 * await startStdio(server, context);
 * ```
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "../server";
import type { ServerContext } from "../types";
import * as Sentry from "@sentry/node";
import { LIB_VERSION } from "../version";
import { runWithContext } from "../context";

/**
 * Starts the MCP server with stdio transport and telemetry.
 *
 * Configures the server with all tools, prompts, and resources, then connects
 * using stdio transport for process-based communication. All operations are
 * wrapped in Sentry tracing for observability.
 *
 * The server is configured once (statically), and the context is made available
 * via AsyncLocalStorage for all requests during the connection lifecycle.
 *
 * @param server - MCP server instance to configure and start
 * @param context - Server context with authentication and configuration
 *
 * @example CLI Integration
 * ```typescript
 * // In a CLI tool or IDE extension:
 * const server = new McpServer();
 * await startStdio(server, {
 *   accessToken: userToken,
 *   sentryHost: "sentry.io",
 *   userId: "user-123",
 *   clientId: "cursor-ide",
 *   constraints: {}
 * });
 * ```
 */
export async function startStdio(server: McpServer, context: ServerContext) {
  await Sentry.startNewTrace(async () => {
    return await Sentry.startSpan(
      {
        name: "mcp.server/stdio",
        attributes: {
          "mcp.transport": "stdio",
          "network.transport": "pipe",
          "service.version": LIB_VERSION,
        },
      },
      async () => {
        // Configure server once (static, no context needed during registration)
        await configureServer({ server });

        // Wrap the entire connection lifecycle with context
        // Handlers will retrieve context from AsyncLocalStorage at call time
        await runWithContext(context, async () => {
          const transport = new StdioServerTransport();
          await server.connect(transport);
        });
      },
    );
  });
}
