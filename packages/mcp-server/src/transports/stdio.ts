import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "../server";
import type { ServerContext } from "../types";
import * as Sentry from "@sentry/node";

export async function startStdio(server: McpServer, context: ServerContext) {
  await Sentry.startNewTrace(async () => {
    const transport = new StdioServerTransport();
    await configureServer({ server, context });
    await server.connect(transport);
  });
}
