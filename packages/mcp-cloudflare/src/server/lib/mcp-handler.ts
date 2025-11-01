/**
 * MCP Handler using experimental_createMcpHandler from Cloudflare agents library.
 *
 * Stateless request handling approach:
 * - Uses experimental_createMcpHandler to wrap the MCP server
 * - Extracts auth props directly from ExecutionContext (set by OAuth provider)
 * - Context captured in tool handler closures during buildServer()
 * - No session state required - each request is independent
 */

import { experimental_createMcpHandler as createMcpHandler } from "agents/mcp";
import { buildServer } from "@sentry/mcp-server/server";
import {
  expandScopes,
  parseScopes,
  type Scope,
} from "@sentry/mcp-server/permissions";
import { parseSkills, type Skill } from "@sentry/mcp-server/skills";
import { logIssue, logWarn } from "@sentry/mcp-server/telem/logging";
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

    // Parse and expand granted scopes (LEGACY - for backward compatibility)
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

    // Parse and validate granted skills (NEW - primary authorization method)
    let grantedSkills: Set<Skill> | undefined;
    if (oauthCtx.props.grantedSkills) {
      const { valid, invalid } = parseSkills(
        oauthCtx.props.grantedSkills as string[],
      );
      if (invalid.length > 0) {
        logWarn("Ignoring invalid skills from OAuth provider", {
          loggerScope: ["cloudflare", "mcp-handler"],
          extra: {
            invalidSkills: invalid,
          },
        });
      }
      grantedSkills = new Set(valid);

      // Validate that at least one valid skill was granted
      if (grantedSkills.size === 0) {
        return new Response(
          "Authorization failed: No valid skills were granted. Please re-authorize and select at least one permission.",
          { status: 400 },
        );
      }
    }

    // Validate that at least one authorization system is active
    // This should never happen in practice - indicates a bug in OAuth flow
    if (!grantedSkills && !expandedScopes) {
      logIssue(
        new Error(
          "No authorization grants found - server would expose no tools",
        ),
        {
          loggerScope: ["cloudflare", "mcp-handler"],
          extra: {
            clientId: oauthCtx.props.clientId,
            hasGrantedSkills: !!oauthCtx.props.grantedSkills,
            hasGrantedScopes: !!oauthCtx.props.grantedScopes,
          },
        },
      );
      return new Response(
        "Authorization failed: No valid permissions were granted. Please re-authorize and select at least one permission.",
        { status: 401 },
      );
    }

    // Build complete ServerContext from OAuth props + verified constraints
    const serverContext: ServerContext = {
      userId: oauthCtx.props.id as string | undefined,
      clientId: oauthCtx.props.clientId as string,
      accessToken: oauthCtx.props.accessToken as string,
      // Scopes derived from skills - for backward compatibility with old MCP clients
      // that don't support grantedSkills and only understand grantedScopes
      grantedScopes: expandedScopes,
      grantedSkills, // Primary authorization method
      constraints: verification.constraints,
      sentryHost,
      mcpUrl: env.MCP_URL,
    };

    // Create and configure MCP server with tools filtered by context
    // Context is captured in tool handler closures during buildServer()
    const server = buildServer({
      context: serverContext,
      tools: isAgentMode ? agentTools : undefined,
    });

    // Run MCP handler - context already captured in closures
    return createMcpHandler(server, {
      route: url.pathname,
    })(request, env, ctx);
  },
};

export default mcpHandler;
