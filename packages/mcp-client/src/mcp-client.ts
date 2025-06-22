import { experimental_createMCPClient } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { logSuccess } from "./logger.js";
import type { MCPConnection, MCPConfig } from "./types.js";

export async function connectToMCPServer(
  config: MCPConfig,
): Promise<MCPConnection> {
  const args = [`--access-token=${config.accessToken}`];
  if (config.host) {
    args.push(`--host=${config.host}`);
  }

  // Resolve the path to the mcp-server binary
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = join(__dirname, "../../mcp-server/dist/index.js");

  const transport = new Experimental_StdioMCPTransport({
    command: "node",
    args: [mcpServerPath, ...args],
    env: {
      ...process.env,
      SENTRY_ACCESS_TOKEN: config.accessToken,
      SENTRY_HOST: config.host || "https://sentry.io",
    },
  });

  const client = await experimental_createMCPClient({
    transport,
  });

  // Discover available tools
  const toolsMap = await client.tools();
  const tools = new Map<string, any>();

  for (const [name, tool] of Object.entries(toolsMap)) {
    tools.set(name, tool);
  }

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
  };
}
