/**
 * MCP Handler using createMcpHandler from Cloudflare agents library.
 *
 * Stateless request handling approach:
 * - Uses createMcpHandler to wrap the MCP server
 * - Extracts auth props directly from ExecutionContext (set by OAuth provider)
 * - Context captured in tool handler closures during buildServer()
 * - No session state required - each request is independent
 */

import { createMcpHandler } from "agents/mcp";
import { buildServer } from "@sentry/mcp-core/server";
import { parseSkills } from "@sentry/mcp-core/skills";
import { logWarn } from "@sentry/mcp-core/telem/logging";
import type { ServerContext } from "@sentry/mcp-core/types";
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

    // Check for experimental mode query parameter
    const isExperimentalMode = url.searchParams.get("experimental") === "1";

    // Extract OAuth props from ExecutionContext (set by OAuth provider)
    const oauthCtx = ctx as OAuthExecutionContext;

    if (!oauthCtx.props) {
      throw new Error("No authentication context available");
    }

    const sentryHost = env.SENTRY_HOST || "sentry.io";

    // Verify user has access to the requested org/project
    // Cache verification results in KV to avoid repeated API calls
    const verification = await verifyConstraintsAccess(
      { organizationSlug, projectSlug },
      {
        accessToken: oauthCtx.props.accessToken as string,
        sentryHost,
        cache: {
          kv: env.MCP_CACHE,
          userId: oauthCtx.props.id as string,
        },
      },
    );

    if (!verification.ok) {
      return new Response(verification.message, {
        status: verification.status ?? 500,
      });
    }

    // Parse and validate granted skills (primary authorization method)
    // Legacy tokens without grantedSkills are no longer supported
    if (!oauthCtx.props.grantedSkills) {
      const userId = oauthCtx.props.id as string;
      const clientId = oauthCtx.props.clientId as string;

      logWarn("Legacy token without grantedSkills detected - revoking grant", {
        loggerScope: ["cloudflare", "mcp-handler"],
        extra: { clientId, userId },
      });

      // Revoke the grant in the background (don't block the response)
      ctx.waitUntil(
        (async () => {
          try {
            // Find the grant for this user/client combination
            const grants = await env.OAUTH_PROVIDER.listUserGrants(userId);
            const grant = grants.items.find((g) => g.clientId === clientId);

            if (grant) {
              await env.OAUTH_PROVIDER.revokeGrant(grant.id, userId);
            }
          } catch (err) {
            logWarn("Failed to revoke legacy grant", {
              loggerScope: ["cloudflare", "mcp-handler"],
              extra: { error: String(err), clientId, userId },
            });
          }
        })(),
      );

      return new Response(
        "Your authorization has expired. Please re-authorize to continue using Sentry MCP.",
        {
          status: 401,
          headers: {
            "WWW-Authenticate":
              'Bearer realm="Sentry MCP", error="invalid_token", error_description="Token requires re-authorization"',
          },
        },
      );
    }

    const { valid: validSkills, invalid: invalidSkills } = parseSkills(
      oauthCtx.props.grantedSkills as string[],
    );

    if (invalidSkills.length > 0) {
      logWarn("Ignoring invalid skills from OAuth provider", {
        loggerScope: ["cloudflare", "mcp-handler"],
        extra: {
          invalidSkills,
        },
      });
    }

    // Validate that at least one valid skill was granted
    if (validSkills.size === 0) {
      logWarn("Authorization rejected: No valid skills in token", {
        loggerScope: ["cloudflare", "mcp-handler"],
        extra: {
          clientId: oauthCtx.props.clientId,
          userId: oauthCtx.props.id,
          rawGrantedSkills: oauthCtx.props.grantedSkills,
          rawGrantedSkillsType: typeof oauthCtx.props.grantedSkills,
          rawGrantedSkillsIsArray: Array.isArray(oauthCtx.props.grantedSkills),
        },
      });
      return new Response(
        "Authorization failed: No valid skills were granted. Please re-authorize and select at least one permission.",
        { status: 400 },
      );
    }

    // Build complete ServerContext from OAuth props + verified constraints
    const serverContext: ServerContext = {
      userId: oauthCtx.props.id as string | undefined,
      clientId: oauthCtx.props.clientId as string,
      accessToken: oauthCtx.props.accessToken as string,
      grantedSkills: validSkills,
      constraints: verification.constraints,
      sentryHost,
      mcpUrl: env.MCP_URL,
      agentMode: isAgentMode,
      experimentalMode: isExperimentalMode,
    };

    // Create and configure MCP server with tools filtered by context
    // Context is captured in tool handler closures during buildServer()
    const server = buildServer({
      context: serverContext,
      agentMode: isAgentMode,
      experimentalMode: isExperimentalMode,
    });

    // Run MCP handler - context already captured in closures
    return createMcpHandler(server, {
      route: url.pathname,
    })(request, env, ctx);
  },
};

export default mcpHandler;
