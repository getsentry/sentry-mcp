import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import type { ServerContext, UrlConstraints } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import { logError } from "@sentry/mcp-server/logging";
import getSentryConfig from "../sentry.config";

/**
 * MCP Transport Durable Object
 *
 * LIFECYCLE (based on McpAgent from agents library):
 *
 * 1. Durable Object Creation:
 *    - OAuth Provider validates token and extracts props (userId, accessToken, etc.)
 *    - DO is created with ID based on user (one DO instance per user)
 *    - init() is called ONCE when DO is created
 *    - fetch() is called for the first request
 *
 * 2. Subsequent Requests (same user):
 *    - Same DO instance is reused (persists in memory)
 *    - ONLY fetch() is called (init() is NOT called again)
 *    - DO stays alive between requests for ~30 seconds of inactivity
 *
 * 3. Hibernation:
 *    - After inactivity, DO hibernates (removed from memory)
 *    - State is persisted to storage
 *
 * 4. Wake from Hibernation:
 *    - When user reconnects after hibernation
 *    - init() is called again to restore state
 *    - fetch() is called for the request
 *
 * CONSTRAINT HANDLING - IMPORTANT ARCHITECTURAL TRADE-OFF:
 *
 * This implementation uses server reconfiguration when constraints change, which is
 * NOT IDEAL but necessary given the current architecture limitations:
 *
 * IDEAL: Each unique set of constraints (org/project) would have its own DO instance,
 * similar to how .mcp.json configurations work locally. This would provide:
 * - Immutable configuration per context
 * - Clear session boundaries
 * - No reconfiguration needed
 *
 * REALITY: We must reconfigure because:
 * 1. The OAuth provider creates DOs based on userId only (not constraints)
 * 2. The agents library controls DO creation via sessionId
 * 3. We cannot cleanly intercept DO creation without fragile hacks
 *
 * ATTEMPTED ALTERNATIVES (see git history):
 * - Constraint-based sessionId manipulation: Too fragile, depends on internals
 * - Multiple server instances per DO: Memory bloat
 * - Custom DO routing: Requires reimplementing MCP protocol handling
 *
 * CURRENT APPROACH:
 * - Detect constraint changes in fetch()
 * - Reconfigure the MCP server when constraints change (~10-50ms overhead)
 * - Store last constraints for hibernation recovery
 *
 * This is a pragmatic solution that:
 * - Works reliably with existing libraries
 * - Is maintainable and debuggable
 * - Has acceptable performance (users rarely switch contexts rapidly)
 * - Prevents state leakage between contexts (fresh server per reconfiguration)
 *
 * Props contain the authenticated user context from the OAuth flow.
 * These are encrypted and stored in the OAuth token, then provided
 * to the Durable Object as this.props on each request.
 * NOTE: Only store persistent user data in props (e.g., userId, accessToken).
 * Request-specific data like user agent should be captured per request.
 */
class SentryMCPBase extends McpAgent<Env, unknown, WorkerProps> {
  server!: McpServer;

  // Track current configuration to detect changes
  private currentConstraintKey: string | null = null;

  // Cache MCP client info to avoid repeated storage reads
  private mcpClientInfo: {
    mcpClientName?: string;
    mcpClientVersion?: string;
    mcpProtocolVersion?: string;
  } | null = null;

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
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
   * Configure the MCP server with given constraints
   *
   * NOTE: This creates a NEW server instance on every reconfiguration.
   * This is required because configureServer() modifies tool schemas based on
   * constraints, and these modifications cannot be cleanly reversed.
   *
   * Performance impact: ~10-50ms to create and configure a new server.
   * This is acceptable since users rarely switch contexts rapidly.
   */
  private async reconfigureServer(constraints: UrlConstraints | null) {
    // Always create a fresh server instance to ensure clean state
    this.server = new McpServer({
      name: "Sentry MCP",
      version: LIB_VERSION,
    });

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
   * Handle incoming requests and manage constraint changes
   *
   * This is where we detect and handle constraint changes. When a user switches
   * from /mcp/org1 to /mcp/org2, we must reconfigure the server with the new
   * constraints to ensure tools operate on the correct organization/project.
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
        `[MCP Transport] Constraint change detected: ${this.currentConstraintKey} → ${constraintKey}`,
      );

      // Store constraints for hibernation recovery
      // This ensures we restore the correct context when DO wakes up
      await this.ctx.storage.put("lastConstraints", {
        constraints,
        key: constraintKey,
      });

      // IMPORTANT: This is the reconfiguration that we'd prefer to avoid
      // but cannot due to architectural constraints (see class documentation).
      // The server is completely recreated to ensure clean state for new constraints.
      //
      // If this fails, we MUST fail the request. Operating with wrong constraints
      // could lead to data being written to the wrong organization/project.
      await this.reconfigureServer(constraints);
    }

    return super.fetch(request);
  }

  /**
   * Initialize on Durable Object creation or hibernation wake
   *
   * Restores the last known state from storage and configures the MCP server.
   * Storage operations are batched for efficiency.
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
    await this.reconfigureServer(constraints);
  }
}

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
