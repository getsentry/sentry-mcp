/**
 * MCP Handler - Routes requests to stateful McpSession Agents.
 *
 * Stateful request handler:
 * - Extracts or generates session ID from mcp-session-id header
 * - Uses getAgentByName to get the Agent instance
 * - Calls agent.onMcpRequest(request) with context in ExecutionContext.props
 *
 * Note: We use string[] instead of Set<Scope>/Set<Skill> because JS
 * Sets don't serialize over Cloudflare's RPC transport to Durable Objects.
 * The McpSession Agent receives SerializableServerContext via ExecutionContext.props
 * and converts arrays back to Sets for use by tools. See SerializableServerContext intypes.ts for details.
 */

import { getAgentByName } from "agents";
import { expandScopes, parseScopes } from "@sentry/mcp-core/permissions";
import { parseSkills } from "@sentry/mcp-core/skills";
import { logIssue, logWarn } from "@sentry/mcp-core/telem/logging";
import type { Env, SerializableServerContext } from "../types";
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
 * 1. Extracts or generates session ID
 * 2. Extracts auth props from ExecutionContext
 * 3. Parses org/project constraints from URL
 * 4. Verifies user has access to the constraints
 * 5. Routes request to McpSession Durable Object with context
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
      logIssue(new Error("No authentication context available"), {
        loggerScope: ["cloudflare", "mcp-handler"],
      });
      return new Response("No authentication context available", {
        status: 401,
      });
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
    let expandedScopes: string[] | undefined;
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
      expandedScopes = Array.from(expandScopes(new Set(valid)));
    }

    // Parse and validate granted skills (NEW - primary authorization method)
    let grantedSkills: string[] | undefined;
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
      grantedSkills = Array.from(valid);

      // Validate that at least one valid skill was granted
      if (valid.size === 0) {
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

    const sessionId =
      request.headers.get("mcp-session-id") ?? crypto.randomUUID();

    const agent = await getAgentByName(env.MCP_SESSION, sessionId);

    const serverContext: SerializableServerContext = {
      userId: oauthCtx.props.id as string | undefined,
      clientId: oauthCtx.props.clientId as string,
      accessToken: oauthCtx.props.accessToken as string,
      // Scopes derived from skills - for backward compatibility with old MCP clients
      // that don't support grantedSkills and only understand grantedScopes
      grantedScopes: expandedScopes,
      grantedSkills, // Primary authorization method
      organizationSlug: verification.constraints.organizationSlug,
      projectSlug: verification.constraints.projectSlug,
      sentryHost,
      mcpUrl: env.MCP_URL,
      isAgentMode,
    };

    // Create ExecutionContext with props - this is how we pass context to the Agent
    const contextWithProps = {
      ...ctx,
      props: serverContext,
    } as ExecutionContext;

    // Call the Agent's onMcpRequest method
    return await agent.onMcpRequest(request, contextWithProps);
  },
};

export default mcpHandler;
