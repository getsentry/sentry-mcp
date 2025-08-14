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

  // Store org/project extracted from URL path
  private urlOrganizationSlug?: string;
  private urlProjectSlug?: string;

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  /**
   * Override fetch to extract org/project from URL path
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Use URLPattern for clean named parameter extraction
    const mcpPattern = new URLPattern({ pathname: "/mcp/:org?/:project?" });
    const ssePattern = new URLPattern({ pathname: "/sse/:org?/:project?" });

    const mcpMatch = mcpPattern.exec(url);
    const sseMatch = ssePattern.exec(url);

    if (mcpMatch?.pathname.groups.org || sseMatch?.pathname.groups.org) {
      const groups = mcpMatch?.pathname.groups || sseMatch?.pathname.groups;
      this.urlOrganizationSlug = groups.org;
      this.urlProjectSlug = groups.project;

      // Store in Durable Object storage so they persist across requests
      await this.ctx.storage.put("urlConstraints", {
        organizationSlug: this.urlOrganizationSlug,
        projectSlug: this.urlProjectSlug,
      });
    } else {
      // Try to load from storage if not in URL
      const stored = await this.ctx.storage.get<{
        organizationSlug?: string;
        projectSlug?: string;
      }>("urlConstraints");
      if (stored) {
        this.urlOrganizationSlug = stored.organizationSlug;
        this.urlProjectSlug = stored.projectSlug;
      }
    }

    return super.fetch(request);
  }

  async init() {
    // Load only MCP client info from storage
    const persistedMcpInfo = await this.ctx.storage.get<{
      mcpClientName?: string;
      mcpClientVersion?: string;
      mcpProtocolVersion?: string;
    }>("mcpClientInfo");

    // Initialize context with fresh auth data from props
    // URL path constraints override OAuth org (if present)
    const serverContext: ServerContext = {
      accessToken: this.props.accessToken,
      organizationSlug: this.urlOrganizationSlug || this.props.organizationSlug,
      projectSlug: this.urlProjectSlug,
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
