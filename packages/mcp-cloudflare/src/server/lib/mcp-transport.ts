import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import getSentryConfig from "../sentry.config";

// Props contain the authenticated user context from the OAuth flow.
// These are encrypted and stored in the OAuth token, then provided
// to the Durable Object as this.props on each request.
// NOTE: Only store persistent user data in props (e.g., userId, accessToken).
// Request-specific data like user agent should be captured per request.
class SentryMCPBase extends McpAgent<Env, unknown, WorkerProps> {
  private cachedUserAgent?: string;
  private serverContext?: any; // Store the context for later updates

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

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  // Override fetch to capture user agent from initial request
  async fetch(request: Request): Promise<Response> {
    // Capture user agent from the initial SSE/WebSocket connection request
    if (!this.cachedUserAgent && request.headers.get("user-agent")) {
      this.cachedUserAgent = request.headers.get("user-agent") || undefined;
      // Persist the user agent to storage
      await this.ctx.storage.put("cachedUserAgent", this.cachedUserAgent);
    }

    return super.fetch(request);
  }

  async init() {
    // Load persisted state from Durable Object storage
    const [persistedContext, persistedUserAgent] = await Promise.all([
      this.ctx.storage.get<any>("serverContext"),
      this.ctx.storage.get<string>("cachedUserAgent"),
    ]);

    // Initialize or restore the context
    this.serverContext = persistedContext || {
      accessToken: this.props.accessToken,
      organizationSlug: this.props.organizationSlug,
      userId: this.props.id,
      mcpUrl: process.env.MCP_URL,
      // User agent is captured from the initial SSE/WebSocket request
      userAgent: persistedUserAgent || this.cachedUserAgent,
    };

    // Restore cached user agent if it was persisted
    if (persistedUserAgent) {
      this.cachedUserAgent = persistedUserAgent;
    }

    // Set up the oninitialized hook before configuring the server
    this.server.server.oninitialized = async () => {
      const serverInstance = this.server.server as any;
      const clientInfo = serverInstance._clientVersion;
      const protocolVersion = serverInstance._protocolVersion;

      if (clientInfo) {
        // Update the context object with client information
        this.serverContext.mcpClientName = clientInfo.name;
        this.serverContext.mcpClientVersion = clientInfo.version;
      }

      if (protocolVersion) {
        this.serverContext.mcpProtocolVersion = protocolVersion;
      }

      // Set server information
      if (serverInstance._serverInfo) {
        this.serverContext.mcpServerName = serverInstance._serverInfo.name;
        this.serverContext.mcpServerVersion =
          serverInstance._serverInfo.version;
      }

      // Persist the updated context to Durable Object storage
      await this.ctx.storage.put("serverContext", this.serverContext);
    };

    await configureServer({
      server: this.server,
      context: this.serverContext,
      onToolComplete: () => {
        this.ctx.waitUntil(Sentry.flush(2000));
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
