import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_HANDLERS } from "./tools";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import type { ServerContext } from "./types";
import { setUser, startNewTrace, startSpan } from "@sentry/core";
import { logError } from "./logging";

export function configureServer({
  server,
  context,
  onToolComplete,
}: { server: McpServer; context: ServerContext; onToolComplete?: () => void }) {
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
        // TODO: sentry isnt supporting SSE super well, so we want to just grab
        // every single tool call as a new trace
        // TODO: this should only use @sentry/cloudflare in CF worker
        return await startNewTrace(async () => {
          return await startSpan(
            { name: `mcp.tool/${tool.name}` },
            async () => {
              if (context.userId) {
                setUser({
                  id: context.userId,
                });
              }

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
                const eventId = logError(error);
                return {
                  content: [
                    {
                      type: "text",
                      text: `**Error**\n\nIt looks like there was a problem communicating with the Sentry API.\n\nPlease give the following information to the Sentry team:\n\n**Event ID**: ${eventId}\n\n${
                        process.env.NODE_ENV !== "production"
                          ? error instanceof Error
                            ? error.message
                            : String(error)
                          : ""
                      }`,
                    },
                  ],
                  isError: true,
                };
              } finally {
                onToolComplete?.();
              }
            },
          );
        });
      },
    );
  }
}
