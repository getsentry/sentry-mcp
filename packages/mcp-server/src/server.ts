import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_HANDLERS } from "./tools";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import type { ServerContext } from "./types";
import { setTag, setUser, startNewTrace, startSpan } from "@sentry/core";
import { logError } from "./logging";
import { RESOURCES } from "./resources";
import { PROMPT_DEFINITIONS } from "./promptDefinitions";
import { PROMPT_HANDLERS } from "./prompts";
import { ApiError } from "./api-client";

function isApiError(error: unknown) {
  return error instanceof ApiError || Object.hasOwn(error as any, "status");
}

async function logAndFormatError(error: unknown) {
  if (isApiError(error)) {
    const typedError = error as ApiError;
    return [
      "**Error**",
      `There was an HTTP ${typedError.status} error with the your request to the Sentry API.`,
      `${typedError.message}`,
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ].join("\n\n");
  }

  const eventId = logError(error);

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

/**
 * Take the arguments from something like an MCP tool call and format
 * them in an OTel-safe way.
 */
function extractMcpParameters(args: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      return [`mcp.param.${key}`, String(value)];
    }),
  );
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
              if (context.clientId) {
                setTag("client.id", context.clientId);
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
              {
                name: `mcp.prompt/${prompt.name}`,
                attributes: extractMcpParameters(args),
              },
              async (span) => {
                if (context.userId) {
                  setUser({
                    id: context.userId,
                  });
                }
                if (context.clientId) {
                  setTag("client.id", context.clientId);
                }
                try {
                  // TODO(dcramer): I'm too dumb to figure this out
                  // @ts-ignore
                  const result = await handler(...args);
                  span.setStatus({
                    code: 1, // ok
                  });
                  return result;
                } catch (error) {
                  span.setStatus({
                    code: 2, // error
                  });
                  throw error;
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
              {
                name: `mcp.tool/${tool.name}`,
                attributes: extractMcpParameters(args),
              },
              async (span) => {
                if (context.userId) {
                  setUser({
                    id: context.userId,
                  });
                }
                if (context.clientId) {
                  setTag("client.id", context.clientId);
                }

                try {
                  // TODO(dcramer): I'm too dumb to figure this out
                  // @ts-ignore
                  const output = await handler(context, ...args);
                  span.setStatus({
                    code: 1, // ok
                  });
                  return {
                    content: [
                      {
                        type: "text",
                        text: output,
                      },
                    ],
                  };
                } catch (error) {
                  span.setStatus({
                    code: 2, // error
                  });
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
