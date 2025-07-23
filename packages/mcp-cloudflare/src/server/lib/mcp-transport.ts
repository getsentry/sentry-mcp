import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import type { ServerContext } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
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

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  // Override fetch to capture user agent from initial request
  async fetch(request: Request): Promise<Response> {
    // User agent is available in request headers if needed for HTTP-specific operations
    return super.fetch(request);
  }

  async init() {
    // Load persisted state from Durable Object storage
    const persistedContext =
      await this.ctx.storage.get<ServerContext>("serverContext");

    // Initialize or restore the context
    const serverContext: ServerContext = persistedContext || {
      accessToken: this.props.accessToken,
      organizationSlug: this.props.organizationSlug,
      userId: this.props.id,
      mcpUrl: process.env.MCP_URL,
    };

    await configureServer({
      server: this.server,
      context: serverContext,
      onToolComplete: () => {
        this.ctx.waitUntil(Sentry.flush(2000));
      },
      onInitialized: async () => {
        try {
          // Persist the updated context to Durable Object storage
          // The context has already been updated by configureServer's oninitialized handler
          await this.ctx.storage.put("serverContext", serverContext);
        } catch (error) {
          // Log the error but don't crash - the server can still function
          // without persisted state, it just won't survive hibernation
          console.error("Failed to persist server context to storage:", error);
          Sentry.captureException(error);
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
