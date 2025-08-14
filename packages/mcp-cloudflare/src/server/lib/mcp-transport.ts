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

  // Store constraints extracted from the request
  private constraints?: {
    organizationSlug?: string;
    projectSlug?: string;
  };

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  /**
   * Override fetch to extract constraints from request headers
   */
  async fetch(request: Request): Promise<Response> {
    // Extract constraints from headers if present
    const orgConstraint = request.headers.get("X-MCP-Constraint-Org");
    const projectConstraint = request.headers.get("X-MCP-Constraint-Project");

    if (orgConstraint || projectConstraint) {
      this.constraints = {
        ...(orgConstraint && { organizationSlug: orgConstraint }),
        ...(projectConstraint && { projectSlug: projectConstraint }),
      };

      // Store constraints in Durable Object storage so they persist
      await this.ctx.storage.put("constraints", this.constraints);
    } else {
      // Try to load constraints from storage if not in headers
      const storedConstraints =
        await this.ctx.storage.get<typeof this.constraints>("constraints");
      if (storedConstraints) {
        this.constraints = storedConstraints;
      }
    }

    // Call the parent fetch method
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
    const serverContext: ServerContext = {
      accessToken: this.props.accessToken,
      organizationSlug: this.props.organizationSlug,
      userId: this.props.id,
      mcpUrl: process.env.MCP_URL,
      // Restore MCP client info if available
      ...persistedMcpInfo,
      // Include constraints from request headers or props
      constraints: this.constraints || this.props.constraints,
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
