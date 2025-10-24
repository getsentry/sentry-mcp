/**
 * MCP Server Configuration and Request Handling Infrastructure.
 *
 * This module orchestrates tool execution and telemetry collection
 * in a unified server interface for LLMs.
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
import tools from "./tools/index";
import type { ServerContext } from "./types";
import { CONSTRAINT_PARAMETER_KEYS } from "./types";
import { setTag, setUser, startNewTrace, startSpan } from "@sentry/core";
import { getLogger, logIssue, type LogIssueOptions } from "./telem/logging";
import { formatErrorForUser } from "./internal/error-handling";
import { LIB_VERSION } from "./version";
import { DEFAULT_SCOPES, MCP_SERVER_NAME } from "./constants";
import { isToolAllowed, type Scope } from "./permissions";
import { getConstraintParametersToInject } from "./internal/constraint-helpers";

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
 * Configures an MCP server with all tools and telemetry.
 *
 * Transforms a bare MCP server instance into a fully-featured Sentry integration
 * with comprehensive observability, error handling, and handler registration.
 *
 * @example Static Context (stdio transport)
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
 *
 * @example Dynamic Context (Cloudflare Workers)
 * ```typescript
 * const server = new McpServer();
 *
 * await configureServer({
 *   server,
 *   getContext: () => {
 *     const authContext = getMcpAuthContext();
 *     const constraints = getConstraints();
 *     return { ...authContext.props, constraints };
 *   }
 * });
 * ```
 */
export async function configureServer({
  server,
  context,
  getContext,
  onToolComplete,
}: {
  server: McpServer;
  /** Static context for stdio/single-request usage */
  context?: ServerContext;
  /** Dynamic context provider for per-request usage (Cloudflare Workers) */
  getContext?: () => ServerContext;
  onToolComplete?: () => void;
}) {
  // Validate that either context or getContext is provided
  if (!context && !getContext) {
    throw new Error("Either context or getContext must be provided");
  }

  // Create context resolver that works for both patterns
  const resolveContext =
    getContext ??
    (() => {
      if (!context) {
        throw new Error("No context available");
      }
      return context;
    });

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

  for (const [toolKey, tool] of Object.entries(tools)) {
    // Filter out constraint parameters from schema that will be auto-injected
    // Since constraints can vary per-request (URL-based), we filter ALL potentially
    // constrainable parameters to avoid confusing clients
    const filteredInputSchema = Object.fromEntries(
      Object.entries(tool.inputSchema).filter(
        ([key]) => !CONSTRAINT_PARAMETER_KEYS.has(key),
      ),
    );

    server.tool(
      tool.name,
      tool.description,
      filteredInputSchema,
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
                // Resolve context per-request
                const context = resolveContext();

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

                // Add constraint attributes to span
                if (context.constraints.organizationSlug) {
                  span.setAttribute(
                    "sentry-mcp.constraint-organization",
                    context.constraints.organizationSlug,
                  );
                }
                if (context.constraints.projectSlug) {
                  span.setAttribute(
                    "sentry-mcp.constraint-project",
                    context.constraints.projectSlug,
                  );
                }

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
