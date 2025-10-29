/**
 * MCP Server Configuration and Request Handling Infrastructure.
 *
 * This module orchestrates tool execution and telemetry collection
 * in a unified server interface for LLMs.
 *
 * **Configuration Example:**
 * ```typescript
 * const server = buildServer({
 *   context: {
 *     accessToken: "your-sentry-token",
 *     sentryHost: "sentry.io",
 *     userId: "user-123",
 *     clientId: "mcp-client",
 *     constraints: {}
 *   },
 *   wrapWithSentry: (s) => Sentry.wrapMcpServerWithSentry(s),
 * });
 * ```
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerRequest,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import tools from "./tools/index";
import type { ToolConfig } from "./tools/types";
import type { ServerContext } from "./types";
import {
  setTag,
  setUser,
  startNewTrace,
  startSpan,
  wrapMcpServerWithSentry,
} from "@sentry/core";
import { logIssue, type LogIssueOptions } from "./telem/logging";
import { formatErrorForUser } from "./internal/error-handling";
import { LIB_VERSION } from "./version";
import { MCP_SERVER_NAME } from "./constants";
import { serverContextStorage } from "./internal/context-storage";
import {
  prepareToolsForContext,
  applyConstraints,
} from "./internal/tool-preparation";

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
 * Creates and configures a complete MCP server with Sentry instrumentation.
 *
 * The server is built with tools filtered based on the granted scopes in the context.
 * AsyncLocalStorage is still used for runtime context propagation during tool execution.
 *
 * @example Usage with stdio transport
 * ```typescript
 * import { buildServer } from "@sentry/mcp-server/server";
 * import { startStdio } from "@sentry/mcp-server/transports/stdio";
 *
 * const context = {
 *   accessToken: process.env.SENTRY_TOKEN,
 *   sentryHost: "sentry.io",
 *   userId: "user-123",
 *   clientId: "cursor-ide",
 *   constraints: {}
 * };
 *
 * const server = buildServer({ context });
 * await startStdio(server, context);
 * ```
 *
 * @example Usage with Cloudflare Workers
 * ```typescript
 * import { serverContextStorage } from "@sentry/mcp-server/internal/context-storage";
 * import { buildServer } from "@sentry/mcp-server/server";
 *
 * const serverContext = buildContextFromOAuth();
 * const server = buildServer({ context: serverContext });
 *
 * // Context is bound per-request for runtime operations
 * return serverContextStorage.run(serverContext, () => {
 *   return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
 * });
 * ```
 */
export function buildServer({
  context,
  onToolComplete,
  tools: customTools,
}: {
  context: ServerContext;
  onToolComplete?: () => void;
  tools?: Record<string, ToolConfig<any>>;
}): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: LIB_VERSION,
  });

  configureServer({ server, context, onToolComplete, tools: customTools });

  return wrapMcpServerWithSentry(server);
}

/**
 * Configures an MCP server with tools filtered by granted scopes.
 *
 * Internal function used by buildServer(). Use buildServer() instead for most cases.
 * Tools are filtered at registration time based on grantedScopes, and context is
 * also resolved from AsyncLocalStorage at runtime for execution.
 */
function configureServer({
  server,
  context,
  onToolComplete,
  tools: customTools,
}: {
  server: McpServer;
  context: ServerContext;
  onToolComplete?: () => void;
  tools?: Record<string, ToolConfig<any>>;
}) {
  // Use custom tools if provided, otherwise use default tools
  const toolsToRegister = customTools ?? tools;

  // Use shared preparation logic to filter by scopes and constraints
  const preparedTools = prepareToolsForContext(toolsToRegister, context);

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

  for (const { key: toolKey, tool, filteredInputSchema } of preparedTools) {
    server.tool(
      tool.name,
      tool.description,
      // Cast needed: filteredInputSchema is Record<string, z.ZodType> (subset of tool.inputSchema)
      // This is safe: MCP validates params at runtime, and we inject constrained fields in handler
      filteredInputSchema as typeof tool.inputSchema,
      tool.annotations,
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
                  "mcp.server.name": MCP_SERVER_NAME,
                  "mcp.server.version": LIB_VERSION,
                  ...extractMcpParameters(params || {}),
                },
              },
              async (span) => {
                // Resolve context per-request for runtime operations
                // Try AsyncLocalStorage first (for Cloudflare Workers), fallback to closure context (for stdio)
                const contextFromStorage = serverContextStorage.getStore();
                const effectiveContext = contextFromStorage ?? context;

                // Add constraint attributes to span
                if (effectiveContext.constraints.organizationSlug) {
                  span.setAttribute(
                    "sentry-mcp.constraint-organization",
                    effectiveContext.constraints.organizationSlug,
                  );
                }
                if (effectiveContext.constraints.projectSlug) {
                  span.setAttribute(
                    "sentry-mcp.constraint-project",
                    effectiveContext.constraints.projectSlug,
                  );
                }

                if (effectiveContext.userId) {
                  setUser({
                    id: effectiveContext.userId,
                  });
                }
                if (effectiveContext.clientId) {
                  setTag("client.id", effectiveContext.clientId);
                }

                try {
                  // Use shared constraint application logic
                  // Constraints overwrite user params (security requirement)
                  const paramsWithConstraints = applyConstraints(
                    params,
                    effectiveContext.constraints,
                    tool.inputSchema,
                  );

                  const output = await tool.handler(
                    paramsWithConstraints,
                    effectiveContext,
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
