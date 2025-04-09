import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logError } from "../lib/logging";
import { TOOL_HANDLERS } from "./tools";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import type { ServerContext } from "./types";

export function configureServer(server: McpServer, context: ServerContext) {
  server.server.onerror = (error) => {
    logError(error);
  };

  for (const tool of TOOL_DEFINITIONS) {
    const handler = TOOL_HANDLERS[tool.name];

    server.tool(
      tool.name as string,
      tool.description,
      tool.paramsSchema ? tool.paramsSchema : {},
      async (...args) => {
        try {
          // TODO(dcramer): I'm too dumb to figure this out
          // @ts-ignore
          const output = await handler(context, ...args);

          return {
            content: [
              {
                type: "text",
                text: output,
              },
            ],
          };
        } catch (error) {
          logError(error);
          return {
            content: [
              {
                type: "text",
                text: `**Error**\n\nIt looks like there was a problem communicating with the Sentry API:\n\n${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}
