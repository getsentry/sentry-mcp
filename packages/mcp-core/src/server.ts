import { McpServer as LegacyMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  McpServer as ModernMcpServer,
  UrlElicitationRequiredError,
  inputRequired,
  inputResponse,
  type ServerContext as SdkServerContext,
} from "@modelcontextprotocol/server";
import {
  getActiveSpan,
  type SpanAttributeValue,
  setTag,
  setUser,
  wrapMcpServerWithSentry,
} from "@sentry/core";
import {
  ApiPermissionError,
  isApiAuthenticationErrorDeep,
  isApiPermissionErrorDeep,
} from "./api-client";
import { MCP_SERVER_NAME } from "./constants";
import {
  formatErrorForUser,
  isExpectedToolError,
} from "./internal/error-handling";
import type { Skill } from "./skills";
import { type LogIssueOptions, logIssue, logWarn } from "./telem/logging";
import {
  executeToolHandler,
  getAvailableTools,
  getFilteredInputSchema,
  injectConstraintParams,
  resolveToolDescription,
  type ToolRegistry,
} from "./tools/catalog-runtime/availability";
import tools from "./tools/index";
import type { StructuredToolOutput } from "./tools/types";
import type { ServerContext } from "./types";
import { LIB_VERSION } from "./version";

/** Walk the cause chain and return the first ApiPermissionError, if any. */
function findPermissionError(error: unknown): ApiPermissionError | undefined {
  let current: unknown = error;
  for (let i = 0; i < 3; i++) {
    if (current instanceof ApiPermissionError) return current;
    if (!(current instanceof Error)) return undefined;
    current = current.cause;
  }
  return undefined;
}

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
 * Detects structured-only tool output. Full CallToolResult objects are excluded
 * so compatibility text generation stays centralized in server.ts.
 */
function isStructuredToolOutput(
  output: unknown,
): output is StructuredToolOutput {
  return (
    !!output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    "structuredContent" in output &&
    !("content" in output) &&
    !!(output as { structuredContent?: unknown }).structuredContent &&
    typeof (output as { structuredContent?: unknown }).structuredContent ===
      "object" &&
    !Array.isArray(
      (output as { structuredContent?: unknown }).structuredContent,
    )
  );
}

/**
 * Wraps structured-only output in an MCP CallToolResult with generated JSON
 * text for clients that do not read structuredContent yet.
 */
function structuredOutputToCallToolResult(
  output: StructuredToolOutput,
): CallToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(output.structuredContent, null, 2),
      },
    ],
    structuredContent: output.structuredContent,
  };
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
 */
type McpServer = LegacyMcpServer | ModernMcpServer;

type BuildServerOptions = {
  context: ServerContext;
  experimentalMode?: boolean;
  tools?: ToolRegistry;
};

export function buildServer(
  options: BuildServerOptions & { sdkVersion: "v2" },
): ModernMcpServer;
export function buildServer(options: BuildServerOptions): LegacyMcpServer;
export function buildServer({
  context,
  experimentalMode = false,
  tools: customTools,
  sdkVersion = "v1",
}: BuildServerOptions & {
  sdkVersion?: "v1" | "v2";
}): McpServer {
  const contextWithModes: ServerContext = {
    ...context,
    experimentalMode,
  };
  const serverInfo = {
    name: MCP_SERVER_NAME,
    version: LIB_VERSION,
  };

  if (sdkVersion === "v2") {
    const server = new ModernMcpServer(serverInfo);
    const registrations = configureServer({
      server,
      context: contextWithModes,
      experimentalMode,
      tools: customTools,
    });
    for (const { name, config, handler } of registrations) {
      server.registerTool(name, config, handler);
    }
    return wrapMcpServerWithSentry(server);
  }

  const server = new LegacyMcpServer(serverInfo);
  const registrations = configureServer({
    server,
    context: contextWithModes,
    experimentalMode,
    tools: customTools,
  });
  for (const { name, config, handler } of registrations) {
    server.registerTool(name, config, handler);
  }
  return wrapMcpServerWithSentry(server);
}

/**
 * Configures an MCP server with tools filtered by granted skills.
 *
 * Internal function used by buildServer(). Use buildServer() instead for most cases.
 * Tools are filtered at registration time based on grantedSkills, and context is
 * captured in closures for tool handler execution.
 */
function configureServer({
  server,
  context,
  experimentalMode = false,
  tools: customTools,
}: {
  server: McpServer;
  context: ServerContext;
  experimentalMode?: boolean;
  tools?: ToolRegistry;
}) {
  const registrations = [];
  const registry: ToolRegistry = customTools ?? tools;

  // Get granted skills from context for tool filtering
  const grantedSkills: Set<Skill> | undefined = context.grantedSkills
    ? new Set<Skill>(context.grantedSkills)
    : undefined;
  const grantedSkillIds = grantedSkills
    ? Array.from(grantedSkills).sort()
    : undefined;
  const availableTools = getAvailableTools({
    tools: registry,
    context,
    experimentalMode,
    useDefaultSurfacePolicy: !customTools,
  });
  const toolsToRegister = availableTools.filter(({ isTopLevel }) => isTopLevel);
  const contextWithToolAvailability: ServerContext = {
    ...context,
    availableToolNames: new Set(
      availableTools.flatMap(({ key, tool }) => [key, tool.name]),
    ),
    directToolNames: new Set(
      toolsToRegister.flatMap(({ key, tool }) => [key, tool.name]),
    ),
  };

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
    const filteredInputSchema = getFilteredInputSchema(
      tool,
      contextWithToolAvailability,
    );
    const resolvedDescription = resolveToolDescription(tool, {
      experimentalMode,
      availableToolNames: contextWithToolAvailability.availableToolNames,
      directToolNames: contextWithToolAvailability.directToolNames,
    });

    const toolRegistration = {
      description: resolvedDescription,
      inputSchema: filteredInputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    };
    const handleToolCall = async (
      params: unknown,
      rawCtx?: unknown,
    ): Promise<CallToolResult> => {
      // v2 SDK passes SdkServerContext; v1 passes RequestHandlerExtra
      // (which lacks mcpReq). The optional chaining on sdkCtx?.mcpReq
      // handles both cases safely.
      const sdkCtx = rawCtx as SdkServerContext | undefined;
      // Get the active MCP server span and attach request-scoped attributes.
      const activeSpan = getActiveSpan();

      if (activeSpan) {
        activeSpan.setAttribute(
          "app.server.mode.experimental",
          experimentalMode,
        );
        if (context.transport) {
          activeSpan.setAttribute("app.transport", context.transport);
        }
        if (context.clientFamily) {
          activeSpan.setAttribute("app.client.family", context.clientFamily);
        }
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
            activeSpan.setAttribute(getSkillGrantedAttributeName(skill), true);
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
      if (context.clientFamily) {
        setTag("app.client.family", context.clientFamily);
      }
      if (context.transport) {
        setTag("app.transport", context.transport);
      }
      setTag("app.server.mode.experimental", experimentalMode);

      try {
        // If the user declined elevation on a previous inputRequired
        // round-trip, return an error instead of re-executing.
        if (sdkCtx?.mcpReq?.inputResponses) {
          const resp = inputResponse(sdkCtx.mcpReq.inputResponses, "elevation");
          if (resp.kind === "elicit" && resp.action !== "accept") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Permission elevation was declined.",
                },
              ],
              isError: true,
            };
          }
        }

        // Always refresh the biscuit token before each tool call.
        // This serves two purposes: (1) picks up write grants if the
        // user approved elevation, and (2) keeps the per-request token
        // fresh since the KV-stored token is a long-lived credential.
        if (context.biscuitTokenManager) {
          await context.biscuitTokenManager.tryElevateViaRefresh();
        }

        const rawParams =
          params && typeof params === "object" && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : {};
        // Apply constraints as parameters, handling aliases (e.g., projectSlug → projectSlugOrId)
        const paramsWithConstraints = injectConstraintParams(
          rawParams,
          tool,
          contextWithToolAvailability,
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
          context: contextWithToolAvailability,
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
        // Some tools return a full MCP CallToolResult for custom content
        // payloads such as images or resources.
        if (isCallToolResult(output)) {
          return output;
        }
        if (isStructuredToolOutput(output)) {
          return structuredOutputToCallToolResult(output);
        }
        throw new Error(`Invalid tool output: ${output}`);
      } catch (error) {
        if (activeSpan) {
          activeSpan.setStatus({
            code: 2, // error
          });
          // Expected tool failures (bad input, AI provider outages, auth expiry)
          // still mark the span as failed, but do not record exceptions so a
          // provider budget/outage does not flood Sentry with per-request noise.
          if (!isExpectedToolError(error)) {
            activeSpan.recordException(error);
          }
        }

        // -32042 must propagate as a JSON-RPC error, not a tool result.
        if (error instanceof UrlElicitationRequiredError) {
          throw error;
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

        // Biscuit 403: insufficient scopes — create an elevation request
        // and ask the user to approve in-browser. The next tool call will
        // pick up the write grant via tryElevateViaRefresh() above.
        const is403 = isApiPermissionErrorDeep(error);
        const hasBTM = !!context.biscuitTokenManager;
        const notElevated =
          hasBTM && !context.biscuitTokenManager!.isElevated();
        if (is403 && hasBTM && notElevated) {
          try {
            // Extract the specific scope(s) the endpoint requires from the
            // RFC 6750 WWW-Authenticate header, so we only ask the user to
            // approve what's actually needed instead of all max scopes.
            const permErr = findPermissionError(error);
            const maxScopes = context.biscuitTokenManager!.getMaxScopes();
            const maxSet = new Set(maxScopes);
            const requiredScopes = permErr?.requiredScopes?.filter((s) =>
              maxSet.has(s),
            );
            const scopesToRequest =
              requiredScopes && requiredScopes.length > 0
                ? requiredScopes
                : maxScopes;
            const elevation =
              await context.biscuitTokenManager!.createElevationRequest(
                scopesToRequest,
              );

            if (elevation) {
              // Stdio is bidirectional — the v2 SDK's legacy shim can
              // push URL elicitation to 2025-era clients over the pipe.
              if (context.transport === "stdio") {
                return inputRequired({
                  inputRequests: {
                    elevation: inputRequired.elicitUrl({
                      url: elevation.url,
                      message:
                        "This action requires elevated permissions. Please approve in your browser.",
                    }),
                  },
                }) as unknown as CallToolResult;
              }

              // Throw -32042 UrlElicitationRequiredError so MCP clients
              // (Claude Code, etc.) auto-open the approval URL in the browser.
              throw new UrlElicitationRequiredError([
                {
                  mode: "url" as const,
                  elicitationId: elevation.elevationId,
                  url: elevation.url,
                  message:
                    "This action requires elevated permissions. Please approve in your browser.",
                },
              ]);
            }
          } catch (elevationErr) {
            if (elevationErr instanceof UrlElicitationRequiredError) {
              throw elevationErr;
            }
            logWarn("Biscuit elevation request failed", {
              loggerScope: ["server", "elevation"],
              extra: { error: String(elevationErr) },
            });
          }
        }

        // CRITICAL: Tool errors MUST be returned as formatted text responses,
        // NOT thrown as exceptions. This ensures consistent error handling
        // and prevents the MCP client from receiving raw error objects.
        //
        // The formatErrorForUser function provides user-friendly error messages
        // with appropriate formatting for different error types:
        // - UserInputError: Clear guidance for fixing input problems
        // - ConfigurationError: Clear guidance for fixing configuration issues
        // - LLMProviderError / AI provider outages: graceful availability message
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
    };

    registrations.push({
      name: tool.name,
      config: toolRegistration,
      handler: handleToolCall,
    });
  }

  return registrations;
}
