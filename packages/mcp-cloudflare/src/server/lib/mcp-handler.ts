/**
 * MCP Handler using experimental_createMcpHandler from Cloudflare agents library.
 *
 * Stateless request handling approach:
 * - Uses experimental_createMcpHandler to wrap the MCP server
 * - Extracts auth props directly from ExecutionContext (set by OAuth provider)
 * - Context captured in tool handler closures during buildServer()
 * - No session state required - each request is independent
 */

import * as Sentry from "@sentry/cloudflare";
import { experimental_createMcpHandler as createMcpHandler } from "agents/mcp";
import { buildServer } from "@sentry/mcp-server/server";
import {
  expandScopes,
  parseScopes,
  type Scope,
} from "@sentry/mcp-server/permissions";
import { logWarn } from "@sentry/mcp-server/telem/logging";
import type { ServerContext } from "@sentry/mcp-server/types";
import type { Env } from "../types";
import { verifyConstraintsAccess } from "./constraint-utils";
import type { ExportedHandler } from "@cloudflare/workers-types";
import agentTools from "@sentry/mcp-server/tools/agent-tools";

/**
 * ExecutionContext with OAuth props injected by the OAuth provider.
 */
type OAuthExecutionContext = ExecutionContext & {
  props?: Record<string, unknown>;
};

/**
 * Main request handler that:
 * 1. Extracts auth props from ExecutionContext
 * 2. Parses org/project constraints from URL
 * 3. Verifies user has access to the constraints
 * 4. Builds complete ServerContext
 * 5. Creates and configures MCP server per-request (context captured in closures)
 * 6. Runs MCP handler
 */
const mcpHandler: ExportedHandler<Env> = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Parse constraints from URL pattern /mcp/:org?/:project?
    const pattern = new URLPattern({ pathname: "/mcp/:org?/:project?" });
    const result = pattern.exec(url);

    if (!result) {
      return new Response("Not found", { status: 404 });
    }

    const { groups } = result.pathname;
    const organizationSlug = groups?.org || null;
    const projectSlug = groups?.project || null;

    // Check for agent mode query parameter
    const isAgentMode = url.searchParams.get("agent") === "1";

    // Extract OAuth props from ExecutionContext (set by OAuth provider)
    const oauthCtx = ctx as OAuthExecutionContext;
    if (!oauthCtx.props) {
      throw new Error("No authentication context available");
    }

    const sentryHost = env.SENTRY_HOST || "sentry.io";

    // Verify user has access to the requested org/project
    const verification = await verifyConstraintsAccess(
      { organizationSlug, projectSlug },
      {
        accessToken: oauthCtx.props.accessToken as string,
        sentryHost,
      },
    );

    if (!verification.ok) {
      return new Response(verification.message, {
        status: verification.status ?? 500,
      });
    }

    // Parse and expand granted scopes
    let expandedScopes: Set<Scope> | undefined;
    if (oauthCtx.props.grantedScopes) {
      const { valid, invalid } = parseScopes(
        oauthCtx.props.grantedScopes as string[],
      );
      if (invalid.length > 0) {
        logWarn("Ignoring invalid scopes from OAuth provider", {
          loggerScope: ["cloudflare", "mcp-handler"],
          extra: {
            invalidScopes: invalid,
          },
        });
      }
      expandedScopes = expandScopes(new Set(valid));
    }

    // Build complete ServerContext from OAuth props + verified constraints
    const serverContext: ServerContext = {
      userId: oauthCtx.props.id as string | undefined,
      clientId: oauthCtx.props.clientId as string,
      accessToken: oauthCtx.props.accessToken as string,
      grantedScopes: expandedScopes,
      constraints: verification.constraints,
      sentryHost,
      mcpUrl: env.MCP_URL,
    };

    // Create and configure MCP server with tools filtered by context
    // Context is captured in tool handler closures during buildServer()
    const server = buildServer({
      context: serverContext,
      tools: isAgentMode ? agentTools : undefined,
      onToolComplete: () => {
        // Flush Sentry events after tool execution
        Sentry.flush(2000);
      },
    });

    // Run MCP handler - context already captured in closures
    const response = await createMcpHandler(server, {
      route: url.pathname,
    })(request, env, ctx);

    // Flush buffered logs before Worker terminates
    ctx.waitUntil(Sentry.flush(2000));

    return response;
  },
};

export default mcpHandler;
