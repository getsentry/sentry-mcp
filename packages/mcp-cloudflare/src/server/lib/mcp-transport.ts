import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import type { ServerContext } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import { logError } from "@sentry/mcp-server/logging";
import getSentryConfig from "../sentry.config";

// Props contain the authenticated user context from the OAuth flow.
// These are encrypted and stored in the OAuth token, then provided
// to the Durable Object as this.props on each request.
// NOTE: Only store persistent user data in props (e.g., userId, accessToken).
// Request-specific data like user agent should be captured per request.
class SentryMCPBase extends McpAgent<Env, unknown, WorkerProps> {
  server = new McpServer({
    name: "Sentry MCP",
    version: LIB_VERSION,
  });
  // Note: This does not work locally with miniflare so we are not using it
  // server = wrapMcpServerWithSentry(
  //   new McpServer({
  //     name: "Sentry MCP",
  //     version: LIB_VERSION,
  //   }),
  // );

  // URL constraints are now stored in Durable Object storage for hibernation persistence

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  /**
   * Override fetch to extract org/project from URL path
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract org/project from URL path using strict regex
    // Only allows alphanumeric, hyphens, underscores, and dots (common in slugs)
    const pathMatch = url.pathname.match(
      /^\/(mcp|sse)(?:\/([a-zA-Z0-9._-]+))?(?:\/([a-zA-Z0-9._-]+))?$/,
    );

    if (pathMatch?.[2]) {
      const orgSlug = pathMatch[2];
      const projectSlug = pathMatch[3]; // May be undefined

      // Additional security validation
      if (
        this.isValidSlug(orgSlug) &&
        (!projectSlug || this.isValidSlug(projectSlug))
      ) {
        // Store in Durable Object storage to persist across hibernation cycles
        await this.ctx.storage.put("urlConstraints", {
          organizationSlug: orgSlug,
          projectSlug: projectSlug,
        });
      }
    }

    return super.fetch(request);
  }

  /**
   * Validates that a slug is safe and follows expected patterns
   */
  private isValidSlug(slug: string): boolean {
    // Reject empty strings
    if (!slug || slug.length === 0) {
      return false;
    }

    // Reject excessively long slugs (prevent DOS)
    if (slug.length > 100) {
      return false;
    }

    // Reject path traversal attempts
    if (slug.includes("..") || slug.includes("//")) {
      return false;
    }

    // Reject URLs or suspicious patterns
    if (slug.includes("://") || slug.includes("%")) {
      return false;
    }

    // Must start and end with alphanumeric
    if (!/^[a-zA-Z0-9].*[a-zA-Z0-9]$/.test(slug) && slug.length > 1) {
      return false;
    }

    // Single character must be alphanumeric
    if (slug.length === 1 && !/^[a-zA-Z0-9]$/.test(slug)) {
      return false;
    }

    return true;
  }

  async init() {
    // Load only MCP client info from storage
    const persistedMcpInfo = await this.ctx.storage.get<{
      mcpClientName?: string;
      mcpClientVersion?: string;
      mcpProtocolVersion?: string;
    }>("mcpClientInfo");

    // Load URL constraints from storage (survives hibernation)
    const urlConstraints = await this.ctx.storage.get<{
      organizationSlug?: string;
      projectSlug?: string;
    }>("urlConstraints");

    const serverContext: ServerContext = {
      accessToken: this.props.accessToken,
      organizationSlug: urlConstraints?.organizationSlug || null,
      projectSlug: urlConstraints?.projectSlug || null,
      userId: this.props.id,
      mcpUrl: process.env.MCP_URL,
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
