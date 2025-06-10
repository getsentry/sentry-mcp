/**
 * MCP Server Configuration and Request Handling Infrastructure.
 *
 * This module orchestrates tool execution, prompt handling, resource management,
 * and telemetry collection in a unified server interface for LLMs.
 *
 * **Configuration Example:**
 * ```typescript
 * const server = new McpServer();
 * const context: ServerContext = {
 *   accessToken: "your-sentry-token",
 *   host: "sentry.io",
 *   userId: "user-123",
 *   clientId: "mcp-client"
 * };
 *
 * await configureServer({ server, context });
 * ```
 */
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
import { UserInputError } from "./errors";

/**
 * Type guard to identify Sentry API errors.
 */
function isApiError(error: unknown) {
  return error instanceof ApiError || Object.hasOwn(error as any, "status");
}

/**
 * Type guard to identify user input validation errors.
 */
function isUserInputError(error: unknown) {
  return error instanceof UserInputError;
}

/**
 * Formats errors for LLM consumption with appropriate telemetry handling.
 *
 * **Error Types:**
 * - User Input Errors: Clear guidance without telemetry
 * - API Errors: Enhanced messaging with HTTP status context
 * - System Errors: Full telemetry capture with event IDs
 *
 * @example User Input Error Response
 * ```markdown
 * **Input Error**
 *
 * It looks like there was a problem with the input you provided.
 * Organization slug is required. Please provide an organizationSlug parameter.
 * You may be able to resolve the issue by addressing the concern and trying again.
 * ```
 */
async function logAndFormatError(error: unknown) {
  if (isUserInputError(error)) {
    const typedError = error as UserInputError;
    return [
      "**Input Error**",
      "It looks like there was a problem with the input you provided.",
      typedError.message,
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ].join("\n\n");
  }

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
 * Extracts MCP request parameters for OpenTelemetry attributes.
 *
 * @example Parameter Transformation
 * ```typescript
 * const input = { organizationSlug: "my-org", query: "is:unresolved" };
 * const output = extractMcpParameters(input);
 * // { "mcp.param.organizationSlug": "\"my-org\"", "mcp.param.query": "\"is:unresolved\"" }
 * ```
 */
function extractMcpParameters(args: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      return [`mcp.param.${key}`, JSON.stringify(value)];
    }),
  );
}

/**
 * Configures an MCP server with all tools, prompts, resources, and telemetry.
 *
 * Transforms a bare MCP server instance into a fully-featured Sentry integration
 * with comprehensive observability, error handling, and handler registration.
 *
 * @example Basic Configuration
 * ```typescript
 * const server = new McpServer();
 * const context = {
 *   accessToken: process.env.SENTRY_TOKEN,
 *   host: "sentry.io",
 *   userId: "user-123",
 *   clientId: "cursor-ide"
 * };
 *
 * await configureServer({ server, context });
 * ```
 */
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
      prompt.paramsSchema ? prompt.paramsSchema : {},
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
                  const output = await handler(context, ...args);
                  span.setStatus({
                    code: 1, // ok
                  });
                  return {
                    messages: [
                      {
                        role: "user",
                        content: {
                          type: "text",
                          text: output,
                        },
                      },
                    ],
                  };
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
