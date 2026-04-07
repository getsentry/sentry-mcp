/**
 * MCP Handler using createMcpHandler from Cloudflare agents library.
 *
 * Stateless request handling approach:
 * - Uses createMcpHandler to wrap the MCP server
 * - Extracts auth props directly from ExecutionContext (set by OAuth provider)
 * - Context captured in tool handler closures during buildServer()
 * - No session state required - each request is independent
 */

import type { ExportedHandler } from "@cloudflare/workers-types";
import { buildServer } from "@sentry/mcp-core/server";
import { parseSkills } from "@sentry/mcp-core/skills";
import { logWarn } from "@sentry/mcp-core/telem/logging";
import type { ServerContext } from "@sentry/mcp-core/types";
import { createMcpHandler } from "agents/mcp";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import * as Sentry from "@sentry/cloudflare";
import type { WorkerProps } from "../types";
import type { Env } from "../types";
import {
  checkRateLimit,
  MCP_RATE_LIMIT_EXCEEDED_MESSAGE,
} from "../utils/rate-limiter";
import { annotateResponseMetric } from "../metrics";
import { verifyConstraintsAccess } from "./constraint-utils";

/**
 * ExecutionContext with OAuth props injected by the OAuth provider.
 */
type OAuthExecutionContext = ExecutionContext & {
  props?: Record<string, unknown>;
};

/**
 * Revokes the OAuth grant for the given user/client pair in the background,
 * then returns a 401 response prompting re-authorization.
 */
function revokeStaleGrant(
  ctx: ExecutionContext,
  env: Env,
  userId: string,
  clientId: string,
  logLabel: string,
  errorDescription = "Token requires re-authorization",
): Response {
  ctx.waitUntil(
    (async () => {
      try {
        const grants = await env.OAUTH_PROVIDER.listUserGrants(userId);
        const grant = grants.items.find((g) => g.clientId === clientId);
        if (grant) {
          await env.OAUTH_PROVIDER.revokeGrant(grant.id, userId);
        }
      } catch (err) {
        logWarn(`Failed to revoke ${logLabel}`, {
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
        "WWW-Authenticate": `Bearer realm="Sentry MCP", error="invalid_token", error_description="${errorDescription}"`,
      },
    },
  );
}

/**
 * Main request handler that:
 * 1. Extracts auth props from ExecutionContext
 * 2. Applies per-user rate limiting for authenticated traffic
 * 3. Parses org/project constraints from URL
 * 4. Verifies user has access to the constraints
 * 5. Builds complete ServerContext
 * 6. Creates and configures MCP server per-request (context captured in closures)
 * 7. Runs MCP handler
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

    const rawProps = oauthCtx.props as Partial<WorkerProps>;

    const userId = rawProps.id as string;
    const accessToken = rawProps.accessToken as string;
    const clientId = rawProps.clientId as string;
    const sentryHost = env.SENTRY_HOST || "sentry.io";

    // Parse and validate granted skills (primary authorization method)
    // Legacy tokens without grantedSkills are no longer supported
    if (!rawProps.grantedSkills) {
      logWarn("Legacy token without grantedSkills detected - revoking grant", {
        loggerScope: ["cloudflare", "mcp-handler"],
        extra: { clientId, userId },
      });
      return revokeStaleGrant(ctx, env, userId, clientId, "legacy grant");
    }

    // Grants created before refreshToken was stored in props are stale and
    // can no longer be silently refreshed. Revoke and force clean re-auth.
    if (!rawProps.refreshToken) {
      Sentry.metrics.count("mcp.oauth.grant_revoked", 1, {
        attributes: { reason: "missing_refresh_token" },
      });
      return revokeStaleGrant(
        ctx,
        env,
        userId,
        clientId,
        "stale grant (missing refresh token)",
      );
    }

    const { valid: validSkills, invalid: invalidSkills } = parseSkills(
      rawProps.grantedSkills as string[],
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
          clientId,
          userId: rawProps.id,
          rawGrantedSkills: rawProps.grantedSkills,
          rawGrantedSkillsType: typeof rawProps.grantedSkills,
          rawGrantedSkillsIsArray: Array.isArray(rawProps.grantedSkills),
        },
      });
      return new Response(
        "Authorization failed: No valid skills were granted. Please re-authorize and select at least one permission.",
        { status: 400 },
      );
    }

    const rateLimitResult = await checkRateLimit(
      userId,
      env.MCP_USER_RATE_LIMITER ?? env.MCP_RATE_LIMITER,
      {
        keyPrefix: "mcp:user",
        errorMessage: MCP_RATE_LIMIT_EXCEEDED_MESSAGE,
      },
    );

    if (!rateLimitResult.allowed) {
      return annotateResponseMetric(
        new Response(rateLimitResult.errorMessage, {
          status: 429,
        }),
        {
          responseReason: "local_rate_limit",
          rateLimitScope: "user",
        },
      );
    }

    // Verify user has access to the requested org/project
    // Cache verification results in KV to avoid repeated API calls
    const verification = await verifyConstraintsAccess(
      { organizationSlug, projectSlug },
      {
        accessToken,
        sentryHost,
        cache: {
          kv: env.MCP_CACHE,
          userId,
        },
      },
    );

    if (!verification.ok) {
      return new Response(verification.message, {
        status: verification.status ?? 500,
      });
    }

    // Build complete ServerContext from OAuth props + verified constraints
    const serverContext: ServerContext = {
      userId,
      clientId,
      accessToken,
      grantedSkills: validSkills,
      constraints: verification.constraints,
      sentryHost,
      mcpUrl: env.MCP_URL,
      agentMode: isAgentMode,
      experimentalMode: isExperimentalMode,
      transport: "http",
    };

    // Create and configure MCP server with tools filtered by context
    // Context is captured in tool handler closures during buildServer()
    // Use CfWorkerJsonSchemaValidator for Cloudflare Workers (ajv is not compatible with workerd)
    const server = buildServer({
      context: serverContext,
      agentMode: isAgentMode,
      experimentalMode: isExperimentalMode,
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    });

    // Run MCP handler - context already captured in closures
    return createMcpHandler(server, {
      route: url.pathname,
    })(request, env, ctx);
  },
};

export default mcpHandler;
