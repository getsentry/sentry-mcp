import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import { runWithContext } from "@sentry/mcp-server/context";
import { expandScopes, parseScopes } from "@sentry/mcp-server/permissions";
import type { Env, WorkerProps } from "../types";
import type { Constraints, ServerContext } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import getSentryConfig from "../sentry.config";
import { verifyConstraintsAccess } from "./constraint-utils";
import type { ExecutionContext } from "@cloudflare/workers-types";

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
 * Static serve() methods extract constraints from URLs and mutate props before DO instantiation,
 * ensuring immutable constraint configuration throughout the DO's lifetime.
 *
 * AUTHENTICATION:
 *
 * User authentication flows through OAuth, with credentials stored in encrypted props
 * that persist across DO hibernation cycles. The DO uses these credentials to authenticate
 * all Sentry API requests on behalf of the MCP client.
 */

/**
 * Sentry MCP Agent - A Durable Object that provides Model Context Protocol access to Sentry.
 *
 * Each DO instance creates its own MCP server with context bound at initialization.
 * This ensures context is available throughout the server's lifecycle without
 * relying on AsyncLocalStorage propagation through the agents library's event handling.
 */
class SentryMCPBase extends McpAgent<
  Env,
  {
    constraints?: Constraints;
  },
  WorkerProps & {
    organizationSlug?: string;
    projectSlug?: string;
  }
> {
  // Each DO instance gets its own MCP server with context bound at creation
  server!: McpServer;

  // Store context for this DO instance
  private serverContext!: ServerContext;

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  /**
   * Initialize Durable Object state
   *
   * Called when the DO is first created or wakes from hibernation.
   * Creates a per-DO MCP server instance with context stored in the DO instance.
   */
  async init() {
    // Initialize constraint state
    if (!this.state?.constraints) {
      this.setState({
        constraints: this.props.constraints,
      });
    }

    // Build context for this DO instance
    this.serverContext = {
      userId: this.props.id,
      mcpUrl: process.env.MCP_URL,
      accessToken: this.props.accessToken,
      grantedScopes: this.props.grantedScopes
        ? expandScopes(parseScopes(this.props.grantedScopes).valid)
        : undefined,
      constraints: this.state.constraints || {},
      sentryHost: (this.env as any)?.SENTRY_HOST || "sentry.io",
    };

    // Create a new MCP server for this DO instance
    this.server = new McpServer({
      name: "Sentry MCP",
      version: LIB_VERSION,
    });

    // Configure the server
    await configureServer({
      server: this.server,
      onToolComplete: () => {
        this.ctx.waitUntil(Sentry.flush(2000));
      },
    });
  }

  /**
   * Override onStart to wrap the transport's onmessage callback with async context.
   *
   * After the parent's onStart connects the server to transport, we intercept
   * the transport's onmessage callback and wrap it with runWithContext().
   * This ensures AsyncLocalStorage propagates through to tool handlers.
   */
  async onStart(
    props?: WorkerProps & {
      organizationSlug?: string;
      projectSlug?: string;
    },
  ) {
    // Call parent implementation which connects server to transport
    await super.onStart(props);

    // Get the transport after parent has set it up
    const transport = (this as any)._transport;
    if (!transport) {
      throw new Error("Transport not initialized after onStart");
    }

    // Store the original onmessage callback
    const originalOnMessage = transport.onmessage;
    if (!originalOnMessage) {
      throw new Error("Transport onmessage not set after server.connect()");
    }

    // Wrap it with our async context
    transport.onmessage = (message: any, extra?: any) => {
      runWithContext(this.serverContext, () => {
        originalOnMessage.call(transport, message, extra);
      });
    };
  }
}

export const SentryMCP = Sentry.instrumentDurableObjectWithSentry(
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

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return SentryMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    const pattern = new URLPattern({ pathname: "/mcp/:org?/:project?" });
    const result = pattern.exec(url);
    if (result) {
      const { groups } = result.pathname;

      const organizationSlug = groups?.org ?? "";
      const projectSlug = groups?.project ?? "";

      // Verify access to org/project using OAuth token
      const verification = await verifyConstraintsAccess(
        { organizationSlug, projectSlug },
        {
          // @ts-ignore props is provided by OAuth provider → agents library
          accessToken: ctx.props?.accessToken,
          sentryHost: (env as any)?.SENTRY_HOST || "sentry.io",
        },
      );
      if (!verification.ok) {
        return new Response(verification.message, {
          status: verification.status ?? 500,
        });
      }

      ctx.props.constraints = verification.constraints;

      return SentryMCP.serve(pattern.pathname).fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
