import { experimental_createMCPClient } from "ai";
import { OAuthClient } from "./auth/oauth.js";
import { DEFAULT_MCP_HOST } from "./constants.js";
import { logError, logSuccess } from "./logger.js";
import type { MCPConnection, RemoteMCPConfig } from "./types.js";

export async function connectToRemoteMCPServer(
  config: RemoteMCPConfig,
): Promise<MCPConnection> {
  const mcpHost = config.mcpHost || DEFAULT_MCP_HOST;
  let accessToken = config.accessToken;

  // If no access token provided, we need to authenticate
  if (!accessToken) {
    const oauthClient = new OAuthClient({
      mcpHost: mcpHost,
    });

    try {
      accessToken = await oauthClient.getAccessToken();
    } catch (error) {
      logError(
        "OAuth authentication failed",
        error instanceof Error ? error : String(error),
      );
      throw error;
    }
  }

  // Create SSE client with authentication
  const client = await experimental_createMCPClient({
    name: "sentry-mcp",
    transport: {
      type: "sse" as const,
      url: `${mcpHost}/sse`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  // Discover available tools
  const toolsMap = await client.tools();
  const tools = new Map<string, any>();

  for (const [name, tool] of Object.entries(toolsMap)) {
    tools.set(name, tool);
  }

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
  };
}
