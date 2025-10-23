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
import { setTag, setUser, startNewTrace, startSpan } from "@sentry/core";
import { getLogger, logIssue, type LogIssueOptions } from "./telem/logging";
import { RESOURCES, isTemplateResource } from "./resources";
import { PROMPT_DEFINITIONS } from "./promptDefinitions";
import { PROMPT_HANDLERS } from "./prompts";
import { formatErrorForUser } from "./internal/error-handling";
import { LIB_VERSION } from "./version";
import { DEFAULT_SCOPES, MCP_SERVER_NAME } from "./constants";
import { isToolAllowed, type Scope } from "./permissions";
import { getConstraintParametersToInject } from "./internal/constraint-helpers";
import { getServerContext } from "./context";

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
 * Gets context from AsyncLocalStorage.
 */
function createResourceHandler(resource: {
  name: string;
  handler: ReadResourceCallback;
}): ReadResourceCallback {
  return async (uri: URL, extra: RequestHandlerExtra<any, any>) => {
    return await startNewTrace(async () => {
      // Get context from AsyncLocalStorage
      const context = getServerContext();
      return await startSpan(
        {
          name: `resources/read ${resource.name}`,
          attributes: {
            "mcp.resource.name": resource.name,
            "mcp.resource.uri": uri.toString(),
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
 * Gets context from AsyncLocalStorage.
 */
function createTemplateResourceHandler(resource: {
  name: string;
  handler: ReadResourceCallback;
}): ReadResourceTemplateCallback {
  return async (
    uri: URL,
    variables: Variables,
    extra: RequestHandlerExtra<any, any>,
  ) => {
    return await startNewTrace(async () => {
      // Get context from AsyncLocalStorage
      const context = getServerContext();
      return await startSpan(
        {
          name: `resources/read ${resource.name}`,
          attributes: {
            "mcp.resource.name": resource.name,
            "mcp.resource.uri": uri.toString(),
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
 * This function is called ONCE to set up the server. All handlers are wrapped to:
 * 1. Get context from AsyncLocalStorage at call time
 * 2. Apply telemetry/tracing
 * 3. Pass context explicitly to the actual handler
 *
 * The server can be shared across multiple connections/contexts because context
 * is retrieved dynamically at each call rather than bound at registration time.
 *
 * @example Static Server Configuration
 * ```typescript
 * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 * import { configureServer } from "./server";
 * import { runWithContext } from "./context";
 *
 * // Configure once
 * const server = new McpServer({ name: "Sentry MCP", version: "1.0.0" });
 * await configureServer({ server });
 *
 * // Use with different contexts
 * await runWithContext(context1, async () => {
 *   await server.connect(transport1);
 * });
 *
 * await runWithContext(context2, async () => {
 *   await server.connect(transport2);
 * });
 * ```
 */
export async function configureServer({
  server,
  onToolComplete,
}: {
  server: McpServer;
  onToolComplete?: () => void;
}) {
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
        createTemplateResourceHandler(resource),
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
        createResourceHandler(resource),
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
            // Get context from AsyncLocalStorage at request time
            const context = getServerContext();
            return await startSpan(
              {
                name: `prompts/get ${prompt.name}`,
                attributes: {
                  "mcp.prompt.name": prompt.name,
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
                  // Pass context explicitly to prompt handler
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
    // Register all tools - scope checking and constraint filtering happens at request time
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema, // Full schema - constraints will be injected at request time
      async (
        params: any,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        try {
          return await startNewTrace(async () => {
            // Get context from AsyncLocalStorage at request time
            const context = getServerContext();

            // Get granted scopes with default to read-only scopes
            const grantedScopes: Set<Scope> = context.grantedScopes
              ? new Set<Scope>(context.grantedScopes)
              : new Set<Scope>(DEFAULT_SCOPES);

            // Check if this tool is allowed based on granted scopes
            if (!isToolAllowed(tool.requiredScopes, grantedScopes)) {
              toolLogger.debug(
                "Tool {tool} not allowed - missing required scopes",
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
              throw new Error(
                `Tool '${tool.name}' is not allowed - missing required scopes`,
              );
            }

            return await startSpan(
              {
                name: `tools/call ${tool.name}`,
                attributes: {
                  "mcp.tool.name": tool.name,
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
                  // Apply constraints as parameters, handling aliases (e.g., projectSlug → projectSlugOrId)
                  const applicableConstraints = getConstraintParametersToInject(
                    context.constraints,
                    tool.inputSchema,
                  );

                  const paramsWithConstraints = {
                    ...params,
                    ...applicableConstraints,
                  };

                  // Pass context explicitly to tool handler!
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
