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
import { isToolAllowed, type Scope } from "./permissions";
import { hasRequiredSkills, type Skill } from "./skills";
import {
  getConstraintParametersToInject,
  getConstraintKeysToFilter,
} from "./internal/constraint-helpers";

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
 * Context is captured in tool handler closures and passed directly to handlers.
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
 * import { buildServer } from "@sentry/mcp-server/server";
 * import { experimental_createMcpHandler as createMcpHandler } from "agents/mcp";
 *
 * const serverContext = buildContextFromOAuth();
 * // Context is captured in closures during buildServer()
 * const server = buildServer({ context: serverContext });
 *
 * // Context already available to tool handlers via closures
 * return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
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
 * Configures an MCP server with tools filtered by granted skills or scopes.
 *
 * Internal function used by buildServer(). Use buildServer() instead for most cases.
 * Tools are filtered at registration time based on grantedSkills OR grantedScopes
 * (either system can grant access), and context is captured in closures for tool handler execution.
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

  // Get granted skills and scopes from context for tool filtering
  const grantedSkills: Set<Skill> | undefined = context.grantedSkills
    ? new Set<Skill>(context.grantedSkills)
    : undefined;

  const grantedScopes: Set<Scope> | undefined = context.grantedScopes
    ? new Set<Scope>(context.grantedScopes)
    : undefined;

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

  for (const [toolKey, tool] of Object.entries(toolsToRegister)) {
    /**
     * Authorization System Precedence
     * ================================
     *
     * The server supports two authorization systems:
     * 1. **Skills System (NEW)** - User-facing permission groups (inspect, triage, etc.)
     * 2. **Scopes System (LEGACY)** - Low-level API permissions (event:read, project:write, etc.)
     *
     * IMPORTANT: These systems are **MUTUALLY EXCLUSIVE** - only one is active per session:
     *
     * ## Skills Mode (when grantedSkills is set):
     *    - ONLY skills are checked (scopes are ignored)
     *    - Tool must have non-empty `requiredSkills` array to be exposed
     *    - Empty `requiredSkills: []` means intentionally excluded from skills system
     *    - Authorization: `allowed = hasRequiredSkills(grantedSkills, tool.requiredSkills)`
     *
     * ## Scopes Mode (when grantedSkills is NOT set, but grantedScopes is set):
     *    - Falls back to legacy scope checking
     *    - Empty `requiredScopes: []` means no scopes required (always allowed)
     *    - Authorization: `allowed = isToolAllowed(tool.requiredScopes, grantedScopes)`
     *
     * ## Tool Visibility:
     *    - If not allowed by active authorization system: tool is NOT registered
     *    - Only registered tools are visible to MCP clients
     *
     * ## Examples:
     *    ```typescript
     *    // Tool available in "triage" skill only:
     *    { requiredSkills: ["triage"], requiredScopes: ["event:write"] }
     *
     *    // Tool available to ALL skills (foundational tool like whoami):
     *    { requiredSkills: ALL_SKILLS, requiredScopes: [] }
     *
     *    // Tool excluded from skills system (like use_sentry in agent mode):
     *    { requiredSkills: [], requiredScopes: [] }
     *    ```
     */
    let allowed = false;

    // Skills system takes precedence when set
    if (grantedSkills) {
      // Tool must have non-empty requiredSkills to be exposed in skills mode
      if (tool.requiredSkills && tool.requiredSkills.length > 0) {
        allowed = hasRequiredSkills(grantedSkills, tool.requiredSkills);
      }
      // Empty requiredSkills means NOT exposed via skills system
    }
    // Legacy fallback: Check scopes if not using skills
    else if (grantedScopes) {
      // isToolAllowed handles empty requiredScopes correctly (returns true)
      allowed = isToolAllowed(tool.requiredScopes, grantedScopes);
    }

    // Skip tool if not allowed by active authorization system
    if (!allowed) {
      continue;
    }

    // Filter out constraint parameters from schema that will be auto-injected
    // Only filter parameters that are ACTUALLY constrained in the current context
    // to avoid breaking tools when constraints are not set
    const constraintKeysToFilter = new Set(
      getConstraintKeysToFilter(context.constraints, tool.inputSchema),
    );
    const filteredInputSchema = Object.fromEntries(
      Object.entries(tool.inputSchema).filter(
        ([key]) => !constraintKeysToFilter.has(key),
      ),
    ) as typeof tool.inputSchema;

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

                  // Execute tool handler with context passed directly
                  // Context is available via the closure and as a parameter
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
