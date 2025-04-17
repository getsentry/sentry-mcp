import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_HANDLERS } from "./tools";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import type { ServerContext } from "./types";

export function configureServer(server: McpServer, context: ServerContext) {
  const { logError } = context;
  server.server.onerror = (error) => {
    if (logError) logError(error);
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
          const eventId = logError ? logError(error) : undefined;
          const output = [
            "**Error**",
            "It looks like there was a problem communicating with the Sentry API.",
          ];
          if (eventId) {
            output.push(
              "Please give the following information to the Sentry team:",
              `**Event ID**: ${eventId}\n\n${
                process.env.NODE_ENV !== "production"
                  ? error instanceof Error
                    ? error.message
                    : String(error)
                  : ""
              }`,
            );
          }
          return {
            content: [
              {
                type: "text",
                text: output.join("\n\n"),
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}
