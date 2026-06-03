import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
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
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  type SpanAttributeValue,
  getActiveSpan,
  setTag,
  setUser,
  wrapMcpServerWithSentry,
} from "@sentry/core";
import { isApiAuthenticationErrorDeep } from "./api-client";
import { MCP_SERVER_NAME } from "./constants";
import { formatErrorForUser } from "./internal/error-handling";
import { type LogIssueOptions, logIssue } from "./telem/logging";
import tools from "./tools/index";
import {
  executeToolHandler,
  getFilteredInputSchema,
  getToolsForMcpRegistration,
  injectConstraintParams,
  resolveToolDescription,
  type RegisteredToolHandlerExtra,
  type ToolRegistry,
} from "./tools/catalog-runtime/availability";
import type { Skill } from "./skills";
import type { ServerContext } from "./types";
import { LIB_VERSION } from "./version";

function getSkillGrantedAttributeName(skill: Skill): string {
  return `app.consent.skill.${skill.replaceAll("-", "_")}.granted`;
}

function isCallToolResult(output: unknown): output is CallToolResult {
  return (
    !!output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    Array.isArray((output as { content?: unknown }).content)
  );
}

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
 * import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
 *
 * const serverContext = buildContextFromOAuth();
 * // Context is captured in closures during buildServer()
 * // Use CfWorkerJsonSchemaValidator for Cloudflare Workers (ajv is not compatible)
 * const server = buildServer({
 *   context: serverContext,
 *   jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
 * });
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
  jsonSchemaValidator,
}: {
  context: ServerContext;
  agentMode?: boolean;
  experimentalMode?: boolean;
  tools?: ToolRegistry;
  /**
   * JSON Schema validator for MCP protocol validation.
   *
   * By default, uses AjvJsonSchemaValidator which requires Node.js.
   * For Cloudflare Workers or other edge runtimes, use CfWorkerJsonSchemaValidator:
   *
   * ```typescript
   * import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
   * buildServer({ context, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
   * ```
   */
  jsonSchemaValidator?: ServerOptions["jsonSchemaValidator"];
}): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: LIB_VERSION,
    },
    { jsonSchemaValidator },
  );

  const contextWithModes: ServerContext = {
    ...context,
    agentMode,
    experimentalMode,
  };

  configureServer({
    server,
    context: contextWithModes,
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
  tools?: ToolRegistry;
}) {
  const registry: ToolRegistry = agentMode
    ? { use_sentry: tools.use_sentry }
    : (customTools ?? tools);

  // Get granted skills from context for tool filtering
  const grantedSkills: Set<Skill> | undefined = context.grantedSkills
    ? new Set<Skill>(context.grantedSkills)
    : undefined;
  const grantedSkillIds = grantedSkills
    ? Array.from(grantedSkills).sort()
    : undefined;
  const toolsToRegister = getToolsForMcpRegistration({
    tools: registry,
    context,
    agentMode,
    experimentalMode,
    useDefaultSurfacePolicy: !customTools || agentMode,
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

  for (const { tool } of toolsToRegister) {
    const filteredInputSchema = getFilteredInputSchema(tool, context);
    const resolvedDescription = resolveToolDescription(tool, experimentalMode);

    server.registerTool(
      tool.name,
      {
        description: resolvedDescription,
        inputSchema: filteredInputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (params: unknown, extra: RegisteredToolHandlerExtra) => {
        // Get the active MCP server span and attach request-scoped attributes.
        const activeSpan = getActiveSpan();

        if (activeSpan) {
          if (context.constraints.organizationSlug) {
            activeSpan.setAttribute(
              "app.constraint.organization_slug",
              context.constraints.organizationSlug,
            );
          }
          if (context.constraints.projectSlug) {
            activeSpan.setAttribute(
              "app.constraint.project_slug",
              context.constraints.projectSlug,
            );
          }
          if (grantedSkillIds?.length) {
            for (const skill of grantedSkillIds) {
              activeSpan.setAttribute(
                getSkillGrantedAttributeName(skill),
                true,
              );
            }
          }
        }

        if (context.userId) {
          const user = {
            id: context.userId,
            ...(context.userIpAddress
              ? { ip_address: context.userIpAddress }
              : {}),
          };
          setUser(user);
        }
        if (context.clientId) {
          setTag("client.id", context.clientId);
        }
        setTag("mode.agent", agentMode);
        setTag("mode.experimental", experimentalMode);

        try {
          const rawParams =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          // Apply constraints as parameters, handling aliases (e.g., projectSlug → projectSlugOrId)
          const paramsWithConstraints = injectConstraintParams(
            rawParams,
            tool,
            context,
          );

          if (activeSpan) {
            // Intentional GenAI semconv extension: per-key attrs like http.request.header.<key>.
            for (const [key, value] of Object.entries(paramsWithConstraints)) {
              const attributeValue =
                value == null || typeof value === "object"
                  ? JSON.stringify(value)
                  : value;
              activeSpan.setAttribute(
                `gen_ai.tool.call.arguments.${key}`,
                attributeValue as SpanAttributeValue | undefined,
              );
            }
          }

          const output = await executeToolHandler({
            tool,
            params: rawParams,
            context,
          });

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
          // Some tools return a full MCP CallToolResult so they can expose
          // structuredContent alongside a text fallback.
          if (isCallToolResult(output)) {
            return output;
          }
          throw new Error(`Invalid tool output: ${output}`);
        } catch (error) {
          if (activeSpan) {
            activeSpan.setStatus({
              code: 2, // error
            });
            activeSpan.recordException(error);
          }

          // Upstream 401 during a tool call — route via the transport so it
          // can revoke the MCP grant; swallow callback errors since the
          // formatted tool response still needs to land.
          if (
            isApiAuthenticationErrorDeep(error) &&
            context.onUpstreamUnauthorized
          ) {
            try {
              await context.onUpstreamUnauthorized();
            } catch {}
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
