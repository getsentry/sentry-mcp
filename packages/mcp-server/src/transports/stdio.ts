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

/**
 * Starts the MCP server with stdio transport and telemetry.
 *
 * Configures the server with all tools, prompts, and resources, then connects
 * using stdio transport for process-based communication. All operations are
 * wrapped in Sentry tracing for observability.
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
 *   host: userHost,
 *   userId: "user-123",
 *   clientId: "cursor-ide"
 * });
 * ```
 */
export async function startStdio(server: McpServer, context: ServerContext) {
  await Sentry.startNewTrace(async () => {
    const transport = new StdioServerTransport();
    await configureServer({ server, context });
    await server.connect(transport);
  });
}
