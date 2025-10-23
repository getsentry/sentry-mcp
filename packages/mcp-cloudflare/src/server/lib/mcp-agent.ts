import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import { expandScopes, parseScopes } from "@sentry/mcp-server/permissions";
import { logWarn } from "@sentry/mcp-server/telem/logging";
import type { Env, WorkerProps } from "../types";
import type { Constraints } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import getSentryConfig from "../sentry.config";
import { verifyConstraintsAccess } from "./constraint-utils";
import type { ExecutionContext } from "@cloudflare/workers-types";

/**
 * Sentry MCP Agent - A Durable Object that provides Model Context Protocol access to Sentry.
 *
 * This class extends the Cloudflare agents library McpAgent to provide authenticated,
 * constraint-scoped access to Sentry's API through MCP tools.
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
 * 5. Request Handling: fetch() processes MCP protocol messages (tools)
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
 * Following the pattern from the gist: this class extends McpAgent and mutates props
 * directly on first request to include URL-extracted constraints. Props are then immutable
 * throughout the DO's lifetime.
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
  // Create server once in constructor, as per Cloudflare MCP Agent API docs
  server = new McpServer({
    name: "Sentry MCP",
    version: LIB_VERSION,
  });

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  /**
   * Initialize Durable Object state and MCP server configuration
   *
   * Called when the DO is first created or wakes from hibernation.
   * Configures the MCP server with user authentication and constraint scoping.
   *
   * Since props (including constraints) are set on first request and then immutable,
   * the server configuration remains constant throughout the DO's lifetime.
   */
  async init() {
    if (!this.state?.constraints) {
      this.setState({
        constraints: this.props.constraints,
      });
    }

    await configureServer({
      server: this.server,
      context: {
        userId: this.props.id,
        mcpUrl: process.env.MCP_URL,
        accessToken: this.props.accessToken,
        grantedScopes: this.props.grantedScopes
          ? (() => {
              const { valid, invalid } = parseScopes(this.props.grantedScopes);
              if (invalid.length > 0) {
                logWarn(`Ignoring invalid scopes from OAuth provider`, {
                  loggerScope: ["cloudflare", "mcp-agent"],
                  extra: {
                    invalidScopes: invalid,
                  },
                });
              }
              return expandScopes(valid);
            })()
          : undefined,
        constraints: this.state.constraints || {},
      },
      onToolComplete: () => {
        this.ctx.waitUntil(Sentry.flush(2000));
      },
    });
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
