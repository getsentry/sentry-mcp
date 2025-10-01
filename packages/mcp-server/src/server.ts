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
import { getLogger, logIssue, type LogIssueOptions } from "./logging";
import { RESOURCES, isTemplateResource } from "./resources";
import { PROMPT_DEFINITIONS } from "./promptDefinitions";
import { PROMPT_HANDLERS } from "./prompts";
import { formatErrorForUser } from "./internal/error-handling";
import { LIB_VERSION } from "./version";
import { DEFAULT_SCOPES, MCP_SERVER_NAME } from "./constants";
import { isToolAllowed, type Scope } from "./permissions";

const toolLogger = getLogger(["server", "tools"]);

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
            ...(context.mcpClientName && {
              "mcp.client.name": context.mcpClientName,
            }),
            ...(context.mcpClientVersion && {
              "mcp.client.version": context.mcpClientVersion,
            }),
            ...(context.mcpProtocolVersion && {
              "mcp.protocol.version": context.mcpProtocolVersion,
            }),
            "mcp.server.name": "Sentry MCP",
            "mcp.server.version": LIB_VERSION,
            ...(context.constraints.organizationSlug && {
              "sentry-mcp.constraint-organization":
                context.constraints.organizationSlug,
            }),
            ...(context.constraints.projectSlug && {
              "sentry-mcp.constraint-project": context.constraints.projectSlug,
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
            ...(context.mcpClientName && {
              "mcp.client.name": context.mcpClientName,
            }),
            ...(context.mcpClientVersion && {
              "mcp.client.version": context.mcpClientVersion,
            }),
            ...(context.mcpProtocolVersion && {
              "mcp.protocol.version": context.mcpProtocolVersion,
            }),
            "mcp.server.name": "Sentry MCP",
            "mcp.server.version": LIB_VERSION,
            ...(context.constraints.organizationSlug && {
              "sentry-mcp.constraint-organization":
                context.constraints.organizationSlug,
            }),
            ...(context.constraints.projectSlug && {
              "sentry-mcp.constraint-project": context.constraints.projectSlug,
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
  onInitialized,
}: {
  server: McpServer;
  context: ServerContext;
  onToolComplete?: () => void;
  onInitialized?: () => void | Promise<void>;
}) {
  // Get granted scopes with default to read-only scopes
  // Normalize to a mutable Set regardless of input being Set or ReadonlySet
  const grantedScopes: Set<Scope> = context.grantedScopes
    ? new Set<Scope>(context.grantedScopes)
    : new Set<Scope>(DEFAULT_SCOPES);

  server.server.onerror = (error) => {
    const transportLogOptions: LogIssueOptions = {
      loggerScope: ["server", "transport"] as const,
      contexts: {
        transport: {
          phase: "server.onerror",
        },
      },
    };

    logIssue(error, transportLogOptions);
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

    // Call the custom onInitialized handler if provided
    // Note: MCP SDK doesn't support async callbacks, so we handle promises
    // without awaiting to avoid blocking the initialization flow
    if (onInitialized) {
      const result = onInitialized();
      if (result instanceof Promise) {
        result.catch((error) => {
          const lifecycleLogOptions: LogIssueOptions = {
            loggerScope: ["server", "lifecycle"] as const,
            contexts: {
              lifecycle: {
                hook: "onInitialized",
                clientName: context.mcpClientName ?? null,
                clientVersion: context.mcpClientVersion ?? null,
                protocolVersion: context.mcpProtocolVersion ?? null,
              },
            },
          };

          logIssue(error, lifecycleLogOptions);
        });
      }
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
                  ...(context.mcpClientName && {
                    "mcp.client.name": context.mcpClientName,
                  }),
                  ...(context.mcpClientVersion && {
                    "mcp.client.version": context.mcpClientVersion,
                  }),
                  ...(context.mcpProtocolVersion && {
                    "mcp.protocol.version": context.mcpProtocolVersion,
                  }),
                  "mcp.server.name": MCP_SERVER_NAME,
                  "mcp.server.version": LIB_VERSION,
                  ...(context.constraints.organizationSlug && {
                    "sentry-mcp.constraint-organization":
                      context.constraints.organizationSlug,
                  }),
                  ...(context.constraints.projectSlug && {
                    "sentry-mcp.constraint-project":
                      context.constraints.projectSlug,
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
    // Check if this tool is allowed based on granted scopes
    if (!isToolAllowed(tool.requiredScopes, grantedScopes)) {
      toolLogger.debug(
        "Skipping tool {tool} - missing required scopes",
        () => ({
          tool: tool.name,
          requiredScopes: Array.isArray(tool.requiredScopes)
            ? tool.requiredScopes
            : tool.requiredScopes
              ? Array.from(tool.requiredScopes)
              : [],
          grantedScopes: [...grantedScopes],
        }),
      );
      continue;
    }

    // Only consider constraints that exist in this tool's schema
    const toolConstraintKeys = Object.entries(context.constraints)
      .filter(([key, value]) => !!value && key in tool.inputSchema)
      .map(([key, _]) => key);

    // Create modified schema by removing constraint parameters that will be injected
    const modifiedInputSchema = Object.fromEntries(
      Object.entries(tool.inputSchema).filter(
        ([key, _]) => !toolConstraintKeys.includes(key),
      ),
    );

    server.tool(
      tool.name,
      tool.description,
      modifiedInputSchema,
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
                  ...(context.mcpClientName && {
                    "mcp.client.name": context.mcpClientName,
                  }),
                  ...(context.mcpClientVersion && {
                    "mcp.client.version": context.mcpClientVersion,
                  }),
                  ...(context.mcpProtocolVersion && {
                    "mcp.protocol.version": context.mcpProtocolVersion,
                  }),
                  "mcp.server.name": MCP_SERVER_NAME,
                  "mcp.server.version": LIB_VERSION,
                  ...(context.constraints.organizationSlug && {
                    "sentry-mcp.constraint-organization":
                      context.constraints.organizationSlug,
                  }),
                  ...(context.constraints.projectSlug && {
                    "sentry-mcp.constraint-project":
                      context.constraints.projectSlug,
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
                  // Double-check scopes at runtime (defense in depth)
                  if (!isToolAllowed(tool.requiredScopes, grantedScopes)) {
                    throw new Error(
                      `Tool '${tool.name}' is not allowed - missing required scopes`,
                    );
                  }

                  // Apply URL constraints as normal parameters - only for params that exist in tool schema
                  const applicableConstraints = Object.fromEntries(
                    Object.entries(context.constraints).filter(
                      ([key, value]) => !!value && key in tool.inputSchema,
                    ),
                  );

                  const paramsWithConstraints = {
                    ...params,
                    ...applicableConstraints,
                  };

                  const output = await tool.handler(
                    paramsWithConstraints,
                    context,
                  );
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
                        text: await formatErrorForUser(error),
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
