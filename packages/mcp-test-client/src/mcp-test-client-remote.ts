import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startNewTrace, startSpan } from "@sentry/core";
import { OAuthClient } from "./auth/oauth.js";
import { DEFAULT_MCP_URL } from "./constants.js";
import { logError, logSuccess } from "./logger.js";
import type { MCPConnection, RemoteMCPConfig } from "./types.js";
import { randomUUID } from "node:crypto";
import { LIB_VERSION } from "./version.js";

export async function connectToRemoteMCPServer(
  config: RemoteMCPConfig,
): Promise<MCPConnection> {
  const sessionId = randomUUID();

  return await startNewTrace(async () => {
    return await startSpan(
      {
        name: "mcp.connect/http",
        attributes: {
          "mcp.transport": "http",
          "gen_ai.conversation.id": sessionId,
          "service.version": LIB_VERSION,
        },
      },
      async (span) => {
        try {
          const mcpHost = config.mcpHost || DEFAULT_MCP_URL;

          // Remove custom attributes - let SDK handle standard attributes
          let accessToken = config.accessToken;

          // If no access token provided, we need to authenticate
          if (!accessToken) {
            await startSpan(
              {
                name: "mcp.auth/oauth",
              },
              async (authSpan) => {
                try {
                  const oauthClient = new OAuthClient({
                    mcpHost: mcpHost,
                  });
                  accessToken = await oauthClient.getAccessToken();
                  authSpan.setStatus({ code: 1 });
                } catch (error) {
                  authSpan.setStatus({ code: 2 });
                  logError(
                    "OAuth authentication failed",
                    error instanceof Error ? error : String(error),
                  );
                  throw error;
                }
              },
            );
          }

          // Create HTTP streaming client with authentication
          // Use ?agent=1 query param for agent mode, otherwise standard /mcp
          // Use ?experimental=1 to enable experimental tools
          const mcpUrl = new URL(`${mcpHost}/mcp`);
          if (config.useAgentEndpoint) {
            mcpUrl.searchParams.set("agent", "1");
          }
          if (config.useExperimental) {
            mcpUrl.searchParams.set("experimental", "1");
          }
          const httpTransport = new StreamableHTTPClientTransport(mcpUrl, {
            requestInit: {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          });

          const client = await experimental_createMCPClient({
            name: "mcp.sentry.dev (test-client)",
            transport: httpTransport,
          });

          // Discover available tools
          const toolsMap = await client.tools();
          const tools = new Map<string, any>();

          for (const [name, tool] of Object.entries(toolsMap)) {
            tools.set(name, tool);
          }

          // Remove custom attributes - let SDK handle standard attributes
          span.setStatus({ code: 1 });

          logSuccess(
            `Connected to MCP server (${mcpHost})`,
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
            transport: "http" as const,
          };
        } catch (error) {
          span.setStatus({ code: 2 });
          throw error;
        }
      },
    );
  });
}
