import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import type { ServerContext, UrlConstraints } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import { logError } from "@sentry/mcp-server/logging";
import getSentryConfig from "../sentry.config";

// Props contain the authenticated user context from the OAuth flow.
// These are encrypted and stored in the OAuth token, then provided
// to the Durable Object as this.props on each request.
// NOTE: Only store persistent user data in props (e.g., userId, accessToken).
// Request-specific data like user agent should be captured per request.
class SentryMCPBase extends McpAgent<Env, unknown, WorkerProps> {
  server!: McpServer;

  // Store constraints in memory for immediate access during init()
  // This solves the race condition where init() might be called before
  // storage operations complete in fetch()
  private pendingConstraints: UrlConstraints | null = null;

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  /**
   * Override fetch to extract org/project constraints from headers.
   *
   * These headers are set by our custom wrapper in index.ts because the
   * agents library's serve() method rewrites the URL path to "/streamable-http",
   * losing the original path parameters. Headers are preserved through this
   * rewriting, making them a reliable way to pass constraint information.
   *
   * Note: fetch() is called before init(), so we store constraints here to ensure
   * they're available when init() creates and configures the server.
   */
  async fetch(request: Request): Promise<Response> {
    // Check if we have constraint headers from our wrapper
    const orgSlugHeader = request.headers.get("X-Sentry-Org-Slug");
    const projectSlugHeader = request.headers.get("X-Sentry-Project-Slug");

    // Update constraints based on headers (always update to ensure they're current)
    // Headers are pre-validated in index.ts, so we can trust them here
    if (orgSlugHeader) {
      // Store new constraints
      const newConstraints: UrlConstraints = {
        organizationSlug: orgSlugHeader,
        projectSlug: projectSlugHeader || undefined,
      };
      // Store in BOTH memory and persistent storage:
      // 1. Memory: For immediate use in init() (avoids race condition)
      // 2. Storage: For hibernation recovery (persists across DO restarts)
      this.pendingConstraints = newConstraints;
      await this.ctx.storage.put("urlConstraints", newConstraints);
    } else {
      // No org header means clear all constraints (user accessed base /mcp path)
      // Clear from both memory and storage
      this.pendingConstraints = null;
      await this.ctx.storage.delete("urlConstraints");
    }

    return super.fetch(request);
  }

  async init() {
    // Create a fresh server instance each time init() is called.
    // This is crucial because configureServer() modifies the tool schemas based on constraints,
    // and we need each Durable Object instance to have its own server with the correct
    // constraints applied. Without this, different DO instances would share mutated schemas.
    this.server = new McpServer({
      name: "Sentry MCP",
      version: LIB_VERSION,
    });

    // Load only MCP client info from storage
    const persistedMcpInfo = await this.ctx.storage.get<{
      mcpClientName?: string;
      mcpClientVersion?: string;
      mcpProtocolVersion?: string;
    }>("mcpClientInfo");

    // Use pending constraints if available (from current request),
    // otherwise load from storage (for hibernation recovery)
    let urlConstraints = this.pendingConstraints;

    if (!urlConstraints) {
      // No pending constraints, try loading from storage (hibernation recovery case)
      urlConstraints =
        (await this.ctx.storage.get<UrlConstraints>("urlConstraints")) || null;
    }

    const serverContext: ServerContext = {
      accessToken: this.props.accessToken,
      userId: this.props.id,
      mcpUrl: process.env.MCP_URL,
      // URL-based session constraints
      constraints: urlConstraints || {},
      // Restore MCP client info if available
      ...persistedMcpInfo,
    };

    await configureServer({
      server: this.server,
      context: serverContext,
      onToolComplete: () => {
        this.ctx.waitUntil(Sentry.flush(2000));
      },
      onInitialized: async () => {
        try {
          // Only persist MCP client attributes that we'll restore later
          const mcpClientInfo = {
            mcpClientName: serverContext.mcpClientName,
            mcpClientVersion: serverContext.mcpClientVersion,
            mcpProtocolVersion: serverContext.mcpProtocolVersion,
          };
          await this.ctx.storage.put("mcpClientInfo", mcpClientInfo);
        } catch (error) {
          // Log the error but don't crash - the server can still function
          // without persisted state, it just won't survive hibernation
          logError(error);
        }
      },
    });
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
