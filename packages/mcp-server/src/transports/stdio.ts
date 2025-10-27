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
import * as Sentry from "@sentry/node";
import { LIB_VERSION } from "../version";
import type { ServerContext } from "../types";
import { serverContextStorage } from "../internal/context-storage";

/**
 * Starts the MCP server with stdio transport and telemetry.
 *
 * Binds the provided context to AsyncLocalStorage and connects the server
 * using stdio transport for process-based communication. All operations are
 * wrapped in Sentry tracing for observability.
 *
 * @param server - Configured and instrumented MCP server instance
 * @param context - Server context with authentication and configuration
 *
 * @example CLI Integration
 * ```typescript
 * import { buildServer } from "./server.js";
 * import { startStdio } from "./transports/stdio.js";
 *
 * const server = buildServer();
 *
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
        // Bind context to AsyncLocalStorage for the lifetime of the connection
        return await serverContextStorage.run(context, async () => {
          const transport = new StdioServerTransport();
          await server.connect(transport);
        });
      },
    );
  });
}
