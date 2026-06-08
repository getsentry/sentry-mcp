import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import { LIB_VERSION } from "@sentry/mcp-core/version";
import * as Sentry from "@sentry/node";

export type StdioServerContext = {
  sentryHost?: string;
  mcpUrl?: string;
  agentMode?: boolean;
  experimentalMode?: boolean;
};

function getStdioSpanAttributes(
  context: StdioServerContext,
): Record<string, string | boolean> {
  const attributes: Record<string, string | boolean> = {
    "app.transport": "stdio",
    "app.server.version": LIB_VERSION,
    "app.server.mode.agent": context.agentMode ?? false,
    "app.server.mode.experimental": context.experimentalMode ?? false,
    "network.transport": "pipe",
    "service.version": LIB_VERSION,
  };

  if (context.sentryHost) {
    attributes["app.upstream.host"] = context.sentryHost;
  }
  if (context.mcpUrl) {
    attributes["app.url.full"] = context.mcpUrl;
  }

  return attributes;
}

/**
 * Starts the MCP server with stdio transport and telemetry.
 *
 * Connects the server using stdio transport for process-based communication.
 * Context is already captured in tool handler closures during buildServer().
 * All operations are wrapped in Sentry tracing for observability.
 *
 * @param server - Configured and instrumented MCP server instance (with context in closures)
 * @param context - Context values used for telemetry attributes
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
export async function startStdio<Context extends StdioServerContext>(
  server: McpServer,
  context: Context,
) {
  await Sentry.startNewTrace(async () => {
    return await Sentry.startSpan(
      {
        name: "mcp.server/stdio",
        attributes: getStdioSpanAttributes(context),
      },
      async () => {
        // Context already captured in tool handler closures during buildServer()
        const transport = new StdioServerTransport();
        await server.connect(transport);
      },
    );
  });
}
