import { experimental_createMCPClient } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startNewTrace, startSpan } from "@sentry/core";
import { logSuccess } from "./logger.js";
import type { MCPConnection, MCPConfig } from "./types.js";
import { randomUUID } from "node:crypto";
import { LIB_VERSION } from "./version.js";

export async function connectToMCPServer(
  config: MCPConfig,
): Promise<MCPConnection> {
  const sessionId = randomUUID();

  return await startNewTrace(async () => {
    return await startSpan(
      {
        name: "mcp.connect/stdio",
        attributes: {
          "mcp.transport": "stdio",
          "gen_ai.conversation.id": sessionId,
          "service.version": LIB_VERSION,
        },
      },
      async (span) => {
        try {
          const args = [`--access-token=${config.accessToken}`];
          if (config.host) {
            args.push(`--host=${config.host}`);
          }
          if (config.sentryDsn) {
            args.push(`--sentry-dsn=${config.sentryDsn}`);
          }
          if (config.useAgentEndpoint) {
            args.push("--agent");
          }
          if (config.useExperimental) {
            args.push("--experimental");
          }

          // Resolve the path to the mcp-server binary
          const __dirname = dirname(fileURLToPath(import.meta.url));
          const mcpServerPath = join(
            __dirname,
            "../../mcp-server/dist/index.js",
          );

          const transport = new Experimental_StdioMCPTransport({
            command: "node",
            args: [mcpServerPath, ...args],
            env: {
              ...process.env,
              SENTRY_ACCESS_TOKEN: config.accessToken,
              SENTRY_HOST: config.host || "sentry.io",
              ...(config.sentryDsn && { SENTRY_DSN: config.sentryDsn }),
            },
          });

          const client = await experimental_createMCPClient({
            name: "mcp.sentry.dev (test-client)",
            transport,
          });

          // Discover available tools
          const toolsMap = await client.tools();
          const tools = new Map<string, any>();

          for (const [name, tool] of Object.entries(toolsMap)) {
            tools.set(name, tool);
          }

          // Remove custom attributes - let SDK handle standard attributes
          span.setStatus({ code: 1 }); // OK status

          logSuccess(
            "Connected to MCP server (stdio)",
            `${tools.size} tools available`,
          );

          const disconnect = async () => {
            await client.close();
          };

          return {
            client,
            tools,
            disconnect,
            sessionId,
            transport: "stdio" as const,
          };
        } catch (error) {
          span.setStatus({ code: 2 }); // Error status
          throw error;
        }
      },
    );
  });
}
