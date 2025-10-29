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

/**
 * Starts the MCP server with stdio transport and telemetry.
 *
 * Connects the server using stdio transport for process-based communication.
 * Context is already captured in tool handler closures during buildServer().
 * All operations are wrapped in Sentry tracing for observability.
 *
 * @param server - Configured and instrumented MCP server instance (with context in closures)
 * @param context - Server context with authentication and configuration (for telemetry attributes)
 *
 * @example CLI Integration
 * ```typescript
 * import { buildServer } from "./server.js";
 * import { startStdio } from "./transports/stdio.js";
 *
 * const context = {
 *   accessToken: userToken,
 *   sentryHost: "sentry.io",
 *   userId: "user-123",
 *   clientId: "cursor-ide",
 *   constraints: {}
 * };
 *
 * const server = buildServer({ context }); // Context captured in closures
 * await startStdio(server, context);
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
        // Context already captured in tool handler closures during buildServer()
        const transport = new StdioServerTransport();
        await server.connect(transport);
      },
    );
  });
}
