import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_HANDLERS } from "./tools";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import type { ServerContext } from "./types";
import { setUser, startNewTrace, startSpan } from "@sentry/core";
import { logError } from "./logging";
import { RESOURCES } from "./resources";
import { PROMPT_DEFINITIONS } from "./promptDefinitions";
import { PROMPT_HANDLERS } from "./prompts";
import { ApiError } from "./api-client";

async function logAndFormatError(error: unknown) {
  const eventId = logError(error);

  if (error instanceof ApiError) {
    return [
      "**Error**",
      `There was an ${error.status} error with the your request to the Sentry API.`,
      `${error.message}`,
      "If you believe this was a genuine error, please report the following to the user for the Sentry team:",
      `**Event ID**: ${eventId}`,
    ].join("\n\n");
  }

  return [
    "**Error**",
    "It looks like there was a problem communicating with the Sentry API.",
    "Please report the following to the user for the Sentry team:",
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

  for (const resource of RESOURCES) {
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

  for (const prompt of PROMPT_DEFINITIONS) {
    const handler = PROMPT_HANDLERS[prompt.name];

    server.prompt(
      prompt.name,
      prompt.description,
      prompt.paramsSchema,
      async (...args) => {
        try {
          return await startNewTrace(async () => {
            return await startSpan(
              { name: `mcp.prompt/${prompt.name}` },
              async () => {
                if (context.userId) {
                  setUser({
                    id: context.userId,
                  });
                }

                // TODO(dcramer): I'm too dumb to figure this out
                // @ts-ignore
                return await handler(...args);
              },
            );
          });
        } finally {
          onToolComplete?.();
        }
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
                        text: await logAndFormatError(error),
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
