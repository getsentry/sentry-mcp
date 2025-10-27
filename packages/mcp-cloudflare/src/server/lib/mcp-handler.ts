/**
 * MCP Handler using experimental_createMcpHandler from Cloudflare agents library.
 *
 * Stateless request handling approach:
 * - Uses experimental_createMcpHandler to wrap the MCP server
 * - Extracts auth props directly from ExecutionContext (set by OAuth provider)
 * - Uses AsyncLocalStorage for per-request ServerContext storage
 * - No session state required - each request is independent
 */

import * as Sentry from "@sentry/cloudflare";
import { experimental_createMcpHandler as createMcpHandler } from "agents/mcp";
import { buildServer } from "@sentry/mcp-server/server";
import { serverContextStorage } from "@sentry/mcp-server/internal/context-storage";
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
 * 5. Creates and configures MCP server per-request
 * 6. Runs MCP handler within ServerContext (AsyncLocalStorage)
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

    // Extract OAuth props from ExecutionContext (set by OAuth provider)
    const oauthCtx = ctx as OAuthExecutionContext;
    if (!oauthCtx.props) {
      throw new Error("No authentication context available");
    }

    const sentryHost =
      (oauthCtx.props.sentryHost as string) || env.SENTRY_HOST || "sentry.io";

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
      userId: oauthCtx.props.userId as string | undefined,
      clientId: oauthCtx.props.clientId as string,
      accessToken: oauthCtx.props.accessToken as string,
      grantedScopes: expandedScopes,
      constraints: verification.constraints,
      sentryHost,
      mcpUrl: oauthCtx.props.mcpUrl as string | undefined,
    };

    // Create and configure MCP server
    const server = buildServer({
      onToolComplete: () => {
        // Flush Sentry events after tool execution
        Sentry.flush(2000);
      },
    });

    // Run MCP handler within ServerContext (AsyncLocalStorage)
    return serverContextStorage.run(serverContext, () => {
      return createMcpHandler(server, {
        route: "/mcp",
      })(request, env, ctx);
    });
  },
};

export default mcpHandler;
