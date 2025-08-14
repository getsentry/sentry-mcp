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

  // URL constraints are now stored in Durable Object storage for hibernation persistence

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
   */
  async fetch(request: Request): Promise<Response> {
    // Check if we have constraint headers (always present from our wrapper)
    const orgSlugHeader = request.headers.get("X-Sentry-Org-Slug");
    const projectSlugHeader = request.headers.get("X-Sentry-Project-Slug");

    // Load current constraints to see if they've changed
    const currentConstraints =
      await this.ctx.storage.get<UrlConstraints>("urlConstraints");

    let constraintsChanged = false;

    // If headers are present (even if empty), update constraints
    if (orgSlugHeader !== null) {
      if (orgSlugHeader === "") {
        // Empty header means clear constraints
        if (currentConstraints) {
          await this.ctx.storage.delete("urlConstraints");
          constraintsChanged = true;
        }
      } else {
        // Validate slugs - throw if invalid since this shouldn't happen
        if (!this.isValidSlug(orgSlugHeader)) {
          throw new Error(`Invalid organization slug: ${orgSlugHeader}`);
        }
        if (
          projectSlugHeader &&
          projectSlugHeader !== "" &&
          !this.isValidSlug(projectSlugHeader)
        ) {
          throw new Error(`Invalid project slug: ${projectSlugHeader}`);
        }

        // Store new constraints
        const newConstraints: UrlConstraints = {
          organizationSlug: orgSlugHeader,
          projectSlug:
            projectSlugHeader && projectSlugHeader !== ""
              ? projectSlugHeader
              : undefined,
        };

        // Check if constraints have changed
        if (
          !currentConstraints ||
          currentConstraints.organizationSlug !==
            newConstraints.organizationSlug ||
          currentConstraints.projectSlug !== newConstraints.projectSlug
        ) {
          await this.ctx.storage.put("urlConstraints", newConstraints);
          constraintsChanged = true;
        }
      }
    }

    // If constraints changed, we need to reinitialize the server with new constraints
    if (constraintsChanged) {
      // Force re-initialization by resetting the init flag
      // Note: This assumes the parent class has an initRun flag or similar
      // We may need to call init() directly here
      await this.init();
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

    // Load URL constraints from storage (survives hibernation)
    const urlConstraints =
      await this.ctx.storage.get<UrlConstraints>("urlConstraints");

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
