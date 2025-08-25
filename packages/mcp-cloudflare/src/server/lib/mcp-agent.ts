import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import type { ServerContext, UrlConstraints } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import { logError } from "@sentry/mcp-server/logging";
import getSentryConfig from "../sentry.config";
import { extractConstraintsWithURLPattern } from "./constraint-utils";

/**
 * Sentry MCP Agent - A Durable Object that provides Model Context Protocol access to Sentry.
 *
 * This class extends the Cloudflare agents library McpAgent to provide authenticated,
 * constraint-scoped access to Sentry's API through MCP tools and resources.
 *
 * ARCHITECTURE:
 *
 * Each MCP client connection creates a unique Durable Object instance via sessionId.
 * The agents library generates sessionIds based on the connection context, ensuring
 * that different constraint contexts (e.g., /mcp/org1/proj1 vs /mcp/org2/proj2)
 * get separate DO instances with immutable configurations.
 *
 * LIFECYCLE:
 *
 * 1. Connection: MCP client connects to URL like /mcp/sentry/my-project
 * 2. Authentication: OAuth flow provides user credentials and permissions
 * 3. DO Creation: Agents library creates DO with unique sessionId for this context
 * 4. Initialization: init() configures MCP server with user auth and URL constraints
 * 5. Request Handling: fetch() processes MCP protocol messages (tools, resources, prompts)
 * 6. Hibernation: DO persists state and hibernates after inactivity
 * 7. Recovery: init() restores state when DO wakes from hibernation
 *
 * CONSTRAINT SCOPING:
 *
 * URL paths like /mcp/sentry/my-project are parsed to extract organization and project
 * constraints. These constraints scope all Sentry API calls to the specific org/project
 * context, ensuring users can only access data they're authorized for within that scope.
 *
 * Static serve() methods extract constraints from URLs and pass them to the DO via headers,
 * where they're used to configure the MCP server's tool contexts on initialization.
 *
 * AUTHENTICATION:
 *
 * User authentication flows through OAuth, with credentials stored in encrypted props
 * that persist across DO hibernation cycles. The DO uses these credentials to authenticate
 * all Sentry API requests on behalf of the MCP client.
 */
class SentryMCPBase extends McpAgent<Env, unknown, WorkerProps> {
  // Create server once in constructor, as per Cloudflare MCP Agent API docs
  server = new McpServer({
    name: "Sentry MCP",
    version: LIB_VERSION,
  });

  // Track current configuration to detect changes
  private currentConstraintKey: string | null = null;

  // Cache MCP client info to avoid repeated storage reads
  private mcpClientInfo: {
    mcpClientName?: string;
    mcpClientVersion?: string;
    mcpProtocolVersion?: string;
  } | null = null;

  // Explicit public constructor to fix Sentry instrumentation type issue
  // biome-ignore lint/complexity/noUselessConstructor: Required for Sentry instrumentation compatibility
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  /**
   * Shared constraint processing logic for both serve methods
   */
  private static processConstraints(
    request: Request,
    urlPattern: string,
  ): { newRequest: Request; errorResponse?: Response } {
    const constraints = extractConstraintsWithURLPattern(
      request.url,
      urlPattern,
    );

    if (constraints.error) {
      return {
        newRequest: request,
        errorResponse: new Response(
          JSON.stringify({
            error: "invalid_request",
            error_description: "Invalid URL format",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      };
    }

    // Pass constraints via headers (compatible with existing McpAgent)
    const headers = new Headers(request.headers);
    if (constraints.organizationSlug) {
      headers.set("X-Sentry-Org-Slug", constraints.organizationSlug);
    }
    if (constraints.projectSlug) {
      headers.set("X-Sentry-Project-Slug", constraints.projectSlug);
    }

    return { newRequest: new Request(request, { headers }) };
  }

  /**
   * Enhanced static serve method with URLPattern support
   * Supports flexible routing: /mcp, /mcp/:org, /mcp/:org/:project
   */
  static serve(urlPattern: string) {
    const baseHandler = McpAgent.serve("/*");

    return {
      fetch: async (
        request: Request,
        env: unknown,
        ctx: ExecutionContext,
      ): Promise<Response> => {
        const { newRequest, errorResponse } = SentryMCPBase.processConstraints(
          request,
          urlPattern,
        );
        if (errorResponse) {
          return errorResponse;
        }
        return baseHandler.fetch(newRequest, env, ctx);
      },
    };
  }

  static serveSSE(urlPattern: string) {
    const baseHandler = McpAgent.serveSSE(urlPattern);

    return {
      fetch: async (
        request: Request,
        env: unknown,
        ctx: ExecutionContext,
      ): Promise<Response> => {
        const { newRequest, errorResponse } = SentryMCPBase.processConstraints(
          request,
          urlPattern,
        );
        if (errorResponse) {
          return errorResponse;
        }
        return baseHandler.fetch(newRequest, env, ctx);
      },
    };
  }

  /**
   * Create a unique key for constraint configuration
   */
  private getConstraintKey(constraints: UrlConstraints | null): string {
    if (!constraints) return "none";
    return `${constraints.organizationSlug || "none"}-${constraints.projectSlug || "none"}`;
  }

  /**
   * Extract constraints from request headers
   */
  private extractConstraints(request: Request): UrlConstraints | null {
    const orgSlug = request.headers.get("X-Sentry-Org-Slug");
    if (!orgSlug) return null;

    return {
      organizationSlug: orgSlug,
      projectSlug: request.headers.get("X-Sentry-Project-Slug") || undefined,
    };
  }

  /**
   * Configure the MCP server with constraint-scoped context
   *
   * Sets up the MCP server with user authentication and constraint scoping (org/project).
   * This configuration determines which Sentry data the MCP tools can access and operates
   * within the security boundary established by the URL constraints and user permissions.
   *
   * Called during DO initialization and after hibernation recovery to establish the
   * server's operational context.
   */
  private async configureServerWithConstraints(
    constraints: UrlConstraints | null,
  ) {
    const serverContext: ServerContext = {
      accessToken: this.props.accessToken,
      userId: this.props.id,
      mcpUrl: process.env.MCP_URL,
      constraints: constraints || {},
      // Include cached MCP client info
      ...(this.mcpClientInfo || {}),
    };

    await configureServer({
      server: this.server,
      context: serverContext,
      onToolComplete: () => {
        this.ctx.waitUntil(Sentry.flush(2000));
      },
      onInitialized: async () => {
        // Only persist MCP client info once (it doesn't change)
        if (!this.mcpClientInfo && serverContext.mcpClientName) {
          this.mcpClientInfo = {
            mcpClientName: serverContext.mcpClientName,
            mcpClientVersion: serverContext.mcpClientVersion,
            mcpProtocolVersion: serverContext.mcpProtocolVersion,
          };

          try {
            await this.ctx.storage.put("mcpClientInfo", this.mcpClientInfo);
          } catch (error) {
            logError(error);
          }
        }
      },
    });

    // Update current configuration tracking
    this.currentConstraintKey = this.getConstraintKey(constraints);
  }

  /**
   * Handle incoming MCP requests
   *
   * Processes Model Context Protocol messages (tool calls, resource requests, etc.)
   * within the constraint context established during DO initialization. Each DO instance
   * maintains consistent constraint scoping throughout its lifetime.
   */
  async fetch(request: Request): Promise<Response> {
    const constraints = this.extractConstraints(request);
    const constraintKey = this.getConstraintKey(constraints);

    // Check if constraints have changed since last request
    // McpAgent guarantees init() is called before fetch(), so currentConstraintKey will be set
    const needsReconfiguration = constraintKey !== this.currentConstraintKey;

    if (needsReconfiguration) {
      // Log constraint change for debugging
      console.log(
        `[MCP Agent] Constraint change detected: ${this.currentConstraintKey} → ${constraintKey}`,
      );

      // Store constraints for hibernation recovery
      // This ensures we restore the correct context when DO wakes up
      await this.ctx.storage.put("lastConstraints", {
        constraints,
        key: constraintKey,
      });

      // IMPORTANT: This reconfiguration is necessary due to MCP SDK limitations.
      // configureServer() creates closures over context at configuration time,
      // so we must reconfigure when constraints change.
      //
      // If this fails, we MUST fail the request. Operating with wrong constraints
      // could lead to data being written to the wrong organization/project.
      await this.configureServerWithConstraints(constraints);
    }

    return super.fetch(request);
  }

  /**
   * Initialize Durable Object state and MCP server configuration
   *
   * Called when the DO is first created or wakes from hibernation. Restores persisted
   * state (client info, constraint context) and configures the MCP server to operate
   * within the established security and constraint boundaries.
   *
   * Ensures the DO is ready to process MCP requests with the correct authentication
   * and scoping context.
   */
  async init() {
    // Load persisted data in parallel for efficiency
    // This reduces storage read latency from sequential to parallel
    const [clientInfo, lastConstraintData] = await Promise.all([
      this.ctx.storage.get<typeof this.mcpClientInfo>("mcpClientInfo"),
      this.ctx.storage.get<{ constraints: UrlConstraints | null; key: string }>(
        "lastConstraints",
      ),
    ]);

    // Cache client info to avoid repeated storage reads
    this.mcpClientInfo = clientInfo || null;

    // Restore last constraints or start fresh
    const constraints = lastConstraintData?.constraints || null;
    this.currentConstraintKey = lastConstraintData?.key || null;

    // Configure server with restored constraints
    // This ensures the server is ready with the correct context after hibernation
    // If this fails, let it bubble up - better to fail initialization than to
    // operate with an incorrectly configured server
    await this.configureServerWithConstraints(constraints);
  }
}

// Export instrumented class as default
export default Sentry.instrumentDurableObjectWithSentry(
  getSentryConfig.partial({
    initialScope: {
      tags: {
        durable_object: true,
        "mcp.server_version": LIB_VERSION,
      },
    },
  }),
  SentryMCPBase,
);
