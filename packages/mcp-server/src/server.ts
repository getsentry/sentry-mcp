import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_HANDLERS } from "./tools";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import type { ServerContext } from "./types";
import { setUser, startNewTrace, startSpan } from "@sentry/core";
import { logError } from "./logging";
import { RESOURCES } from "./resources";

function logAndFormatError(error: unknown) {
  const eventId = logError(error);
  return [
    "**Error**",
    "It looks like there was a problem communicating with the Sentry API.",
    "Please give the following information to the Sentry team:",
    `**Event ID**: ${eventId}`,
    process.env.NODE_ENV !== "production"
      ? error instanceof Error
        ? error.message
        : String(error)
      : "",
  ].join("\n\n");
}

export async function configureServer({
  server,
  context,
  onToolComplete,
}: { server: McpServer; context: ServerContext; onToolComplete?: () => void }) {
  server.server.onerror = (error) => {
    logError(error);
  };

  const resources = RESOURCES;
  for (const resource of resources) {
    server.resource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: resource.mimeType,
      },
      // TODO: this doesnt support any error handling afaict via the spec
      async (url) => {
        return await startNewTrace(async () => {
          return await startSpan(
            { name: `mcp.resource/${resource.name}` },
            async () => {
              if (context.userId) {
                setUser({
                  id: context.userId,
                });
              }

              return resource.handler(url);
            },
          );
        });
      },
    );
  }

  for (const tool of TOOL_DEFINITIONS) {
    const handler = TOOL_HANDLERS[tool.name];

    server.tool(
      tool.name as string,
      tool.description,
      tool.paramsSchema ? tool.paramsSchema : {},
      async (...args) => {
        // TODO: sentry isnt supporting SSE super well, so we want to just grab
        // every single tool call as a new trace
        try {
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
                  return {
                    content: [
                      {
                        type: "text",
                        text: logAndFormatError(error),
                      },
                    ],
                    isError: true,
                  };
                }
              },
            );
          });
        } finally {
          onToolComplete?.();
        }
      },
    );
  }
}
