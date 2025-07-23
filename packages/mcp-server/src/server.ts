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
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerRequest,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ReadResourceCallback,
  ReadResourceTemplateCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import tools from "./tools/index";
import type { ServerContext } from "./types";
import { setTag, setUser, startNewTrace, startSpan } from "@sentry/core";
import { logError } from "./logging";
import { RESOURCES, isTemplateResource } from "./resources";
import { PROMPT_DEFINITIONS } from "./promptDefinitions";
import { PROMPT_HANDLERS } from "./prompts";
import { ApiError } from "./api-client";
import { UserInputError, ConfigurationError } from "./errors";

/**
 * Type guard to identify Sentry API errors.
 */
function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Type guard to identify user input validation errors.
 */
function isUserInputError(error: unknown): error is UserInputError {
  return error instanceof UserInputError;
}

/**
 * Type guard to identify configuration errors.
 */
function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError;
}

/**
 * Formats errors for LLM consumption with appropriate telemetry handling.
 *
 * **Error Types:**
 * - User Input Errors: Clear guidance without telemetry
 * - Configuration Errors: Configuration guidance without telemetry
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
 *
 * @example Configuration Error Response
 * ```markdown
 * **Configuration Error**
 *
 * There appears to be a configuration issue with your setup.
 * Unable to connect to sentry.invalid.com - Hostname not found. Verify the URL is correct.
 * Please check your environment configuration and try again.
 * ```
 */
async function logAndFormatError(error: unknown) {
  if (isUserInputError(error)) {
    return [
      "**Input Error**",
      "It looks like there was a problem with the input you provided.",
      error.message,
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ].join("\n\n");
  }

  if (isConfigurationError(error)) {
    return [
      "**Configuration Error**",
      "There appears to be a configuration issue with your setup.",
      error.message,
      `Please check your environment configuration and try again.`,
    ].join("\n\n");
  }

  if (isApiError(error)) {
    // Log 500+ errors to Sentry for debugging
    const eventId = error.status >= 500 ? logError(error) : undefined;

    return [
      "**Error**",
      `There was an HTTP ${error.status} error with your request to the Sentry API.`,
      `${error.message}`,
      eventId ? `**Event ID**: ${eventId}` : "",
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ]
      .filter(Boolean)
      .join("\n\n");
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
 * // { "mcp.request.argument.organizationSlug": "\"my-org\"", "mcp.request.argument.query": "\"is:unresolved\"" }
 * ```
 */
function extractMcpParameters(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      return [`mcp.request.argument.${key}`, JSON.stringify(value)];
    }),
  );
}

/**
 * Creates a telemetry wrapper for regular URI resource handlers.
 * Captures URI access and user context for observability.
 */
function createResourceHandler(
  resource: { name: string; handler: ReadResourceCallback },
  context: ServerContext,
): ReadResourceCallback {
  return async (uri: URL, extra: RequestHandlerExtra<any, any>) => {
    return await startNewTrace(async () => {
      return await startSpan(
        {
          name: `resources/read ${resource.name}`,
          attributes: {
            "mcp.resource.name": resource.name,
            "mcp.resource.uri": uri.toString(),
            ...(context.mcpClientName && context.mcpClientVersion
              ? {
                  "user_agent.original": `${context.mcpClientName}/${context.mcpClientVersion}`,
                }
              : context.userAgent && {
                  "user_agent.original": context.userAgent,
                }),
            ...(context.mcpClientName && {
              "mcp.client.name": context.mcpClientName,
            }),
            ...(context.mcpClientVersion && {
              "mcp.client.version": context.mcpClientVersion,
            }),
            ...(context.mcpProtocolVersion && {
              "mcp.protocol.version": context.mcpProtocolVersion,
            }),
            ...(context.mcpServerName && {
              "mcp.server.name": context.mcpServerName,
            }),
            ...(context.mcpServerVersion && {
              "mcp.server.version": context.mcpServerVersion,
            }),
          },
        },
        async () => {
          if (context.userId) {
            setUser({
              id: context.userId,
            });
          }
          if (context.clientId) {
            setTag("client.id", context.clientId);
          }

          return resource.handler(uri, extra);
        },
      );
    });
  };
}

/**
 * Creates a telemetry wrapper for URI template resource handlers.
 * Captures template parameters and user context for observability.
 */
function createTemplateResourceHandler(
  resource: { name: string; handler: ReadResourceCallback },
  context: ServerContext,
): ReadResourceTemplateCallback {
  return async (
    uri: URL,
    variables: Variables,
    extra: RequestHandlerExtra<any, any>,
  ) => {
    return await startNewTrace(async () => {
      return await startSpan(
        {
          name: `resources/read ${resource.name}`,
          attributes: {
            "mcp.resource.name": resource.name,
            "mcp.resource.uri": uri.toString(),
            ...(context.mcpClientName && context.mcpClientVersion
              ? {
                  "user_agent.original": `${context.mcpClientName}/${context.mcpClientVersion}`,
                }
              : context.userAgent && {
                  "user_agent.original": context.userAgent,
                }),
            ...(context.mcpClientName && {
              "mcp.client.name": context.mcpClientName,
            }),
            ...(context.mcpClientVersion && {
              "mcp.client.version": context.mcpClientVersion,
            }),
            ...(context.mcpProtocolVersion && {
              "mcp.protocol.version": context.mcpProtocolVersion,
            }),
            ...(context.mcpServerName && {
              "mcp.server.name": context.mcpServerName,
            }),
            ...(context.mcpServerVersion && {
              "mcp.server.version": context.mcpServerVersion,
            }),
            ...extractMcpParameters(variables),
          },
        },
        async () => {
          if (context.userId) {
            setUser({
              id: context.userId,
            });
          }
          if (context.clientId) {
            setTag("client.id", context.clientId);
          }

          // The MCP SDK has already constructed the URI from the template and variables
          // We just need to call the handler with the constructed URI
          return resource.handler(uri, extra);
        },
      );
    });
  };
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

  // Hook into the initialized notification to capture client information
  server.server.oninitialized = () => {
    const serverInstance = server.server as any;
    const clientInfo = serverInstance._clientVersion;
    const protocolVersion = serverInstance._protocolVersion;

    // Update the context object with client information
    if (clientInfo) {
      context.mcpClientName = clientInfo.name;
      context.mcpClientVersion = clientInfo.version;
    }

    if (protocolVersion) {
      context.mcpProtocolVersion = protocolVersion;
    }

    // Set server information
    if (serverInstance._serverInfo) {
      context.mcpServerName = serverInstance._serverInfo.name;
      context.mcpServerVersion = serverInstance._serverInfo.version;
    }
  };

  for (const resource of RESOURCES) {
    if (isTemplateResource(resource)) {
      // Handle URI template resources
      server.registerResource(
        resource.name,
        resource.template,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        createTemplateResourceHandler(resource, context),
      );
    } else {
      // Handle regular URI resources
      server.registerResource(
        resource.name,
        resource.uri,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        createResourceHandler(resource, context),
      );
    }
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
                name: `prompts/get ${prompt.name}`,
                attributes: {
                  "mcp.prompt.name": prompt.name,
                  ...(context.mcpClientName && context.mcpClientVersion
                    ? {
                        "user_agent.original": `${context.mcpClientName}/${context.mcpClientVersion}`,
                      }
                    : context.userAgent && {
                        "user_agent.original": context.userAgent,
                      }),
                  ...(context.mcpClientName && {
                    "mcp.client.name": context.mcpClientName,
                  }),
                  ...(context.mcpClientVersion && {
                    "mcp.client.version": context.mcpClientVersion,
                  }),
                  ...(context.mcpProtocolVersion && {
                    "mcp.protocol.version": context.mcpProtocolVersion,
                  }),
                  ...(context.mcpServerName && {
                    "mcp.server.name": context.mcpServerName,
                  }),
                  ...(context.mcpServerVersion && {
                    "mcp.server.version": context.mcpServerVersion,
                  }),
                  ...extractMcpParameters(args[0] || {}),
                },
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
                        role: "user" as const,
                        content: {
                          type: "text" as const,
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

  for (const [toolKey, tool] of Object.entries(tools)) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      async (
        params: any,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        try {
          return await startNewTrace(async () => {
            return await startSpan(
              {
                name: `tools/call ${tool.name}`,
                attributes: {
                  "mcp.tool.name": tool.name,
                  ...(context.mcpClientName && context.mcpClientVersion
                    ? {
                        "user_agent.original": `${context.mcpClientName}/${context.mcpClientVersion}`,
                      }
                    : context.userAgent && {
                        "user_agent.original": context.userAgent,
                      }),
                  ...(context.mcpClientName && {
                    "mcp.client.name": context.mcpClientName,
                  }),
                  ...(context.mcpClientVersion && {
                    "mcp.client.version": context.mcpClientVersion,
                  }),
                  ...(context.mcpProtocolVersion && {
                    "mcp.protocol.version": context.mcpProtocolVersion,
                  }),
                  ...(context.mcpServerName && {
                    "mcp.server.name": context.mcpServerName,
                  }),
                  ...(context.mcpServerVersion && {
                    "mcp.server.version": context.mcpServerVersion,
                  }),
                  ...extractMcpParameters(params || {}),
                },
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
                  const output = await tool.handler(params, context);
                  span.setStatus({
                    code: 1, // ok
                  });
                  // if the tool returns a string, assume it's a message
                  if (typeof output === "string") {
                    return {
                      content: [
                        {
                          type: "text" as const,
                          text: output,
                        },
                      ],
                    };
                  }
                  // if the tool returns a list, assume it's a content list
                  if (Array.isArray(output)) {
                    return {
                      content: output,
                    };
                  }
                  throw new Error(`Invalid tool output: ${output}`);
                } catch (error) {
                  span.setStatus({
                    code: 2, // error
                  });

                  // CRITICAL: Tool errors MUST be returned as formatted text responses,
                  // NOT thrown as exceptions. This ensures consistent error handling
                  // and prevents the MCP client from receiving raw error objects.
                  //
                  // The logAndFormatError function provides user-friendly error messages
                  // with appropriate formatting for different error types:
                  // - UserInputError: Clear guidance for fixing input problems
                  // - ConfigurationError: Clear guidance for fixing configuration issues
                  // - ApiError: HTTP status context with helpful messaging
                  // - System errors: Sentry event IDs for debugging
                  //
                  // DO NOT change this to throw error - it breaks error handling!
                  return {
                    content: [
                      {
                        type: "text" as const,
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
