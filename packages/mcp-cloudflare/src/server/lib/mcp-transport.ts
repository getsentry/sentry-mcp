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
 * CONSTRAINT HANDLING:
 * - Constraints come from URL path (e.g., /mcp/org1/project1)
 * - Same user can connect with different constraints
 * - Ideally, each DO would be immutably coupled to its constraints (like in .mcp.json)
 * - However, since OAuth provider creates DOs per-user (not per-constraint-set), we must:
 *   1. Detect constraint changes in fetch()
 *   2. Reconfigure the MCP server when constraints change
 *   3. Store last constraints for hibernation recovery
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
   */
  private async reconfigureServer(constraints: UrlConstraints | null) {
    // Always create a fresh server instance
    // (Required because configureServer modifies tool schemas based on constraints)
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
   */
  async fetch(request: Request): Promise<Response> {
    const constraints = this.extractConstraints(request);
    const constraintKey = this.getConstraintKey(constraints);

    // Check if constraints have changed
    // McpAgent guarantees init() is called before fetch(), so currentConstraintKey will be set
    const needsReconfiguration = constraintKey !== this.currentConstraintKey;

    if (needsReconfiguration) {
      // Store constraints for hibernation recovery
      await this.ctx.storage.put("lastConstraints", {
        constraints,
        key: constraintKey,
      });

      // Reconfigure the server with new constraints
      // Note: Ideally constraints would be immutable per DO instance, but since
      // the OAuth provider creates DOs based on userId only (not constraints),
      // we must handle constraint changes when users switch contexts
      await this.reconfigureServer(constraints);
    }

    return super.fetch(request);
  }

  /**
   * Initialize on Durable Object creation or hibernation wake
   */
  async init() {
    // Load persisted data in parallel for efficiency
    const [clientInfo, lastConstraintData] = await Promise.all([
      this.ctx.storage.get<typeof this.mcpClientInfo>("mcpClientInfo"),
      this.ctx.storage.get<{ constraints: UrlConstraints | null; key: string }>(
        "lastConstraints",
      ),
    ]);

    // Cache client info
    this.mcpClientInfo = clientInfo || null;

    // Restore last constraints or start fresh
    const constraints = lastConstraintData?.constraints || null;
    this.currentConstraintKey = lastConstraintData?.key || null;

    // Configure server with restored constraints
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
