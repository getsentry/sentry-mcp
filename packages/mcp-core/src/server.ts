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
import tools, {
  AGENT_DEPENDENT_TOOLS,
  SIMPLE_REPLACEMENT_TOOLS,
} from "./tools/index";
import {
  type ToolConfig,
  resolveDescription,
  isToolVisibleInMode,
} from "./tools/types";
import type { ServerContext, ProjectCapabilities } from "./types";
import {
  setTag,
  setUser,
  getActiveSpan,
  wrapMcpServerWithSentry,
} from "@sentry/core";
import { logIssue, type LogIssueOptions } from "./telem/logging";
import { formatErrorForUser } from "./internal/error-handling";
import { LIB_VERSION } from "./version";
import { MCP_SERVER_NAME } from "./constants";
import { isEnabledBySkills, type Skill } from "./skills";
import {
  getConstraintParametersToInject,
  getConstraintKeysToFilter,
} from "./internal/constraint-helpers";
import { hasAgentProvider } from "./internal/agents/provider-factory";

/**
 * Creates and configures a complete MCP server with Sentry instrumentation.
 *
 * The server is built with tools filtered based on the granted skills in the context.
 * Context is captured in tool handler closures and passed directly to handlers.
 *
 * @example Usage with stdio transport
 * ```typescript
 * import { buildServer } from "@sentry/mcp-core/server";
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
 * import { buildServer } from "@sentry/mcp-core/server";
 * import { createMcpHandler } from "agents/mcp";
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
  agentMode = false,
  experimentalMode = false,
  tools: customTools,
}: {
  context: ServerContext;
  agentMode?: boolean;
  experimentalMode?: boolean;
  tools?: Record<string, ToolConfig<any>>;
}): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: LIB_VERSION,
  });

  configureServer({
    server,
    context,
    agentMode,
    experimentalMode,
    tools: customTools,
  });

  return wrapMcpServerWithSentry(server);
}

/**
 * Configures an MCP server with tools filtered by granted skills.
 *
 * Internal function used by buildServer(). Use buildServer() instead for most cases.
 * Tools are filtered at registration time based on grantedSkills, and context is
 * captured in closures for tool handler execution.
 *
 * In agent mode, only the use_sentry tool is registered, bypassing authorization checks.
 */
function configureServer({
  server,
  context,
  agentMode = false,
  experimentalMode = false,
  tools: customTools,
}: {
  server: McpServer;
  context: ServerContext;
  agentMode?: boolean;
  experimentalMode?: boolean;
  tools?: Record<string, ToolConfig<any>>;
}) {
  // Determine which tools to register:
  // - Agent mode: only use_sentry
  // - Custom tools provided: use those
  // - Default: all standard tools
  let toolsToRegister = agentMode
    ? { use_sentry: tools.use_sentry }
    : (customTools ?? tools);

  // Filter tools based on agent provider availability
  // Skip filtering in agent mode (use_sentry handles all tools internally) or when custom tools are provided
  if (!agentMode && !customTools) {
    const hasAgent = hasAgentProvider();
    const toolsToExclude = new Set<string>(
      hasAgent ? SIMPLE_REPLACEMENT_TOOLS : AGENT_DEPENDENT_TOOLS,
    );

    toolsToRegister = Object.fromEntries(
      Object.entries(toolsToRegister).filter(
        ([key]) => !toolsToExclude.has(key),
      ),
    ) as typeof toolsToRegister;
  }

  // Filter tools based on experimental mode (applies to all tools, including custom)
  // Skip in agent mode (use_sentry handles filtering internally)
  if (!agentMode) {
    toolsToRegister = Object.fromEntries(
      Object.entries(toolsToRegister).filter(([, tool]) =>
        isToolVisibleInMode(tool, experimentalMode),
      ),
    ) as typeof toolsToRegister;
  }

  // Get granted skills from context for tool filtering
  const grantedSkills: Set<Skill> | undefined = context.grantedSkills
    ? new Set<Skill>(context.grantedSkills)
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
     * Skills-Based Authorization
     * ==========================
     *
     * Tools are filtered at registration time based on grantedSkills.
     * Tool must have non-empty `skills` array to be exposed.
     * Empty `skills: []` means intentionally excluded from skills system.
     *
     * In agent mode, authorization is skipped - use_sentry handles it internally.
     *
     * ## Examples:
     *    ```typescript
     *    // Tool belongs to "triage" skill only:
     *    { skills: ["triage"] }
     *
     *    // Tool belongs to ALL skills (foundational tool like whoami):
     *    { skills: ALL_SKILLS }
     *
     *    // Tool excluded from skills system (like use_sentry in agent mode):
     *    { skills: [] }
     *    ```
     */
    let allowed = false;

    // In agent mode, skip authorization - use_sentry handles it internally
    if (agentMode) {
      allowed = true;
    }
    // Skills system: tool must have non-empty skills to be exposed
    else if (grantedSkills) {
      if (tool.skills && tool.skills.length > 0) {
        allowed = isEnabledBySkills(grantedSkills, tool.skills);
      }
      // Empty skills means NOT exposed via skills system
    }

    // Skip tool if not allowed by active authorization system
    if (!allowed) {
      continue;
    }

    // Skip list tools when context is constrained to a specific tenant/project
    // When organizationSlug is constrained, find_organizations is not useful
    // When projectSlug is constrained, find_projects is not useful
    if (
      (toolKey === "find_organizations" &&
        context.constraints.organizationSlug) ||
      (toolKey === "find_projects" && context.constraints.projectSlug)
    ) {
      continue;
    }

    // Skip tools when project lacks required capabilities (experimental)
    // Fail-open: if capabilities are unknown, show all tools
    if (
      experimentalMode &&
      context.constraints.projectSlug &&
      context.constraints.projectCapabilities &&
      tool.requiredCapabilities?.length
    ) {
      const caps = context.constraints.projectCapabilities;
      const hasAllCapabilities = tool.requiredCapabilities.every(
        (cap: keyof ProjectCapabilities) => caps[cap] === true,
      );
      if (!hasAllCapabilities) {
        continue;
      }
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

    // Resolve dynamic descriptions based on server context
    const resolvedDescription = resolveDescription(tool.description, {
      experimentalMode,
    });

    server.tool(
      tool.name,
      resolvedDescription,
      filteredInputSchema,
      tool.annotations,
      async (
        params: any,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        // Get active span (mcp.server span) and attach more attributes to it
        const activeSpan = getActiveSpan();

        if (activeSpan) {
          if (context.constraints.organizationSlug) {
            activeSpan.setAttribute(
              "sentry-mcp.constraint-organization",
              context.constraints.organizationSlug,
            );
          }
          if (context.constraints.projectSlug) {
            activeSpan.setAttribute(
              "sentry-mcp.constraint-project",
              context.constraints.projectSlug,
            );
          }
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

          const output = await tool.handler(paramsWithConstraints, context);

          if (activeSpan) {
            activeSpan.setStatus({
              code: 1, // ok
            });
          }

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
          if (activeSpan) {
            activeSpan.setStatus({
              code: 2, // error
            });
            activeSpan.recordException(error);
          }

          // CRITICAL: Tool errors MUST be returned as formatted text responses,
          // NOT thrown as exceptions. This ensures consistent error handling
          // and prevents the MCP client from receiving raw error objects.
          //
          // The formatErrorForUser function provides user-friendly error messages
          // with appropriate formatting for different error types:
          // - UserInputError: Clear guidance for fixing input problems
          // - ConfigurationError: Clear guidance for fixing configuration issues
          // - LLMProviderError: Clear messaging for AI provider availability issues
          // - ApiError: HTTP status context with helpful messaging
          // - System errors: Sentry event IDs for debugging
          //
          // DO NOT change this to throw error - it breaks error handling!
          return {
            content: [
              {
                type: "text" as const,
                text: await formatErrorForUser(error, {
                  transport: context.transport,
                }),
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}
