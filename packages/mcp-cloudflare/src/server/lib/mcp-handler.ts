/**
 * MCP Handler using experimental_createMcpHandler from Cloudflare agents library.
 *
 * This handler replaces the Durable Object-based McpAgent with a simpler stateless approach:
 * - Uses experimental_createMcpHandler to wrap the MCP server
 * - Gets auth context from getMcpAuthContext() (set by OAuth provider)
 * - Uses AsyncLocalStorage for per-request constraint scoping
 * - No Durable Objects or session state required
 */

import * as Sentry from "@sentry/cloudflare";
import {
  experimental_createMcpHandler as createMcpHandler,
  getMcpAuthContext,
  type McpAuthContext,
} from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import { constraintsStorage } from "@sentry/mcp-server/internal/context-storage";
import {
  expandScopes,
  parseScopes,
  type Scope,
} from "@sentry/mcp-server/permissions";
import { logWarn } from "@sentry/mcp-server/telem/logging";
import type { ServerContext } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import type { Env } from "../types";
import { verifyConstraintsAccess } from "./constraint-utils";
import type { ExportedHandler } from "@cloudflare/workers-types";

/**
 * Main request handler that:
 * 1. Creates and configures MCP server per-request
 * 2. Parses org/project constraints from URL
 * 3. Verifies user has access to the constraints
 * 4. Runs MCP handler within constraint context (AsyncLocalStorage)
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
    const organizationSlug = groups?.org ?? "";
    const projectSlug = groups?.project ?? "";

    // Get OAuth props from context (set by OAuth provider)
    const authContext = getMcpAuthContext();
    if (!authContext?.props) {
      return new Response("Unauthorized - No authentication context", {
        status: 401,
      });
    }

    // Verify user has access to the requested org/project
    const verification = await verifyConstraintsAccess(
      { organizationSlug, projectSlug },
      {
        accessToken: authContext.props.accessToken as string,
        sentryHost:
          (authContext.props.sentryHost as string) ||
          env.SENTRY_HOST ||
          "sentry.io",
      },
    );

    if (!verification.ok) {
      return new Response(verification.message, {
        status: verification.status ?? 500,
      });
    }

    // 1. Create MCP server
    const server = new McpServer({
      name: "Sentry MCP",
      version: LIB_VERSION,
    });

    // 2. Configure server with dynamic context provider
    await configureServer({
      server,
      getContext: (): ServerContext => {
        // Get OAuth-provided auth context
        const authContext: McpAuthContext | undefined = getMcpAuthContext();
        if (!authContext?.props) {
          throw new Error("No authentication context available");
        }

        // Get constraints from AsyncLocalStorage (set per-request)
        const constraints = constraintsStorage.getStore() || {};

        // Parse and expand granted scopes
        let expandedScopes: Set<Scope> | undefined;
        if (authContext.props.grantedScopes) {
          const { valid, invalid } = parseScopes(
            authContext.props.grantedScopes as string[],
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

        // Build ServerContext from OAuth props + constraints
        return {
          userId: authContext.props.userId as string | undefined,
          clientId: authContext.props.clientId as string,
          accessToken: authContext.props.accessToken as string,
          grantedScopes: expandedScopes,
          constraints,
          sentryHost: (authContext.props.sentryHost as string) || "sentry.io",
          mcpUrl: authContext.props.mcpUrl as string | undefined,
        };
      },
      onToolComplete: () => {
        // Flush Sentry events after tool execution
        Sentry.flush(2000);
      },
    });

    // 3. Return wrapped server handler within constraint context
    return constraintsStorage.run(verification.constraints, () => {
      return createMcpHandler(server, {
        route: "/mcp",
      })(request, env, ctx);
    });
  },
};

export default mcpHandler;
