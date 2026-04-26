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
import { resolveClientFamily } from "./client-family";
import { verifyConstraintsAccess } from "./constraint-utils";

/**
 * ExecutionContext with OAuth props injected by the OAuth provider.
 */
type OAuthExecutionContext = ExecutionContext & {
  props?: Record<string, unknown>;
};

function escapeAuthenticateHeaderValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "")
    .replaceAll("\n", "");
}

/**
 * The wrapper bearer token format from `@cloudflare/workers-oauth-provider` is
 * `userId:grantId:secret`. The library validates the token before our handler
 * runs, so when we're here the format is known to be correct. Pulling the
 * grantId out lets us target the exact grant for the current request — under
 * `revokeExistingGrants: false`, multiple grants for the same `(userId,
 * clientId)` may coexist, so finding by clientId would risk killing the wrong
 * session.
 */
function getRequestGrantId(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const parts = match[1].split(":");
  if (parts.length !== 3) return null;
  return parts[1] || null;
}

/**
 * Revokes the OAuth grant for the current request in the background, then
 * returns a 401 response prompting re-authorization.
 */
function revokeStaleGrant(
  ctx: ExecutionContext,
  env: Env,
  userId: string,
  clientId: string,
  grantId: string | null,
  logLabel: string,
  errorDescription = "Token requires re-authorization",
): Response {
  ctx.waitUntil(
    (async () => {
      if (!grantId) {
        // Without a grantId, falling back to clientId-based lookup would
        // risk revoking another active session. Log and skip — the user
        // will still see the 401 and re-auth, just leaving the stale grant
        // behind to expire naturally (refreshTokenTTL = 30d).
        logWarn(`Cannot revoke ${logLabel} without grantId`, {
          loggerScope: ["cloudflare", "mcp-handler"],
          extra: { clientId, userId },
        });
        return;
      }
      try {
        await env.OAUTH_PROVIDER.revokeGrant(grantId, userId);
      } catch (err) {
        logWarn(`Failed to revoke ${logLabel}`, {
          loggerScope: ["cloudflare", "mcp-handler"],
          extra: { error: String(err), clientId, userId, grantId },
        });
      }
    })(),
  );
  return new Response(
    "Your authorization has expired. Please re-authorize to continue using Sentry MCP.",
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer realm="Sentry MCP", error="invalid_token", error_description="${escapeAuthenticateHeaderValue(errorDescription)}"`,
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
    const clientFamily = resolveClientFamily(request.headers.get("user-agent"));
    const requestGrantId = getRequestGrantId(request);
    Sentry.setUser({ id: userId });

    // Parse and validate granted skills (primary authorization method)
    // Legacy tokens without grantedSkills are no longer supported
    if (!rawProps.grantedSkills) {
      logWarn("Legacy token without grantedSkills detected - revoking grant", {
        loggerScope: ["cloudflare", "mcp-handler"],
        extra: { clientId, userId },
      });
      return revokeStaleGrant(
        ctx,
        env,
        userId,
        clientId,
        requestGrantId,
        "legacy grant",
      );
    }

    // Attribute values avoid the substring "token" so Sentry's default PII
    // scrubber doesn't replace them with "[Filtered]" on ingest. Only emit
    // when we're actually going to revoke; otherwise the count drifts away
    // from "grants we actually deleted from KV".
    if (!rawProps.refreshToken) {
      if (requestGrantId) {
        Sentry.metrics.count("mcp.oauth.grant_revoked", 1, {
          attributes: {
            reason: "stale_props_no_refresh",
            client_family: clientFamily,
          },
        });
      }
      return revokeStaleGrant(
        ctx,
        env,
        userId,
        clientId,
        requestGrantId,
        "stale grant (missing refresh token)",
      );
    }

    if (rawProps.upstreamTokenInvalid) {
      if (requestGrantId) {
        Sentry.metrics.count("mcp.oauth.grant_revoked", 1, {
          attributes: {
            reason: "upstream_rejected",
            client_family: clientFamily,
          },
        });
      }
      return revokeStaleGrant(
        ctx,
        env,
        userId,
        clientId,
        requestGrantId,
        "stale grant (invalid upstream token)",
        "Upstream authorization is no longer valid",
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

    const tokenOrg = rawProps.constraintOrganizationSlug?.trim() || null;
    const tokenProject = rawProps.constraintProjectSlug?.trim() || null;
    if (tokenOrg && organizationSlug !== tokenOrg) {
      return new Response(
        "This token is scoped to an organization. Use the MCP URL for the organization you authorized.",
        { status: 403 },
      );
    }
    if (tokenProject) {
      if (!projectSlug || projectSlug !== tokenProject) {
        return new Response(
          "This token is scoped to a project. Use the MCP URL that includes that project (for example /mcp/<org>/<project>).",
          { status: 403 },
        );
      }
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

    const constraints = verification.constraints;

    // Build complete ServerContext from OAuth props + verified constraints.
    // `upstreamUnauthorizedHandled` de-dupes within the request — use_sentry
    // runs multiple sub-tool calls in a single request, and each would
    // otherwise fire the callback independently against the same dead grant.
    let upstreamUnauthorizedHandled = false;
    const serverContext: ServerContext = {
      userId,
      clientId,
      accessToken,
      grantedSkills: validSkills,
      constraints,
      sentryHost,
      mcpUrl: env.MCP_URL,
      agentMode: isAgentMode,
      experimentalMode: isExperimentalMode,
      transport: "http",
      onUpstreamUnauthorized: () => {
        if (upstreamUnauthorizedHandled) return;
        upstreamUnauthorizedHandled = true;
        if (!requestGrantId) {
          // Same reasoning as revokeStaleGrant: without a grantId, falling
          // back to clientId-based lookup would risk killing another active
          // session now that grants can coexist. Skip the metric too so the
          // count stays aligned with grants we actually deleted from KV.
          logWarn("Cannot revoke grant after upstream 401 without grantId", {
            loggerScope: ["cloudflare", "mcp-handler"],
            extra: { clientId, userId },
          });
          return;
        }
        Sentry.metrics.count("mcp.oauth.grant_revoked", 1, {
          attributes: {
            reason: "upstream_rejected_in_use",
            client_family: clientFamily,
          },
        });
        ctx.waitUntil(
          (async () => {
            try {
              await env.OAUTH_PROVIDER.revokeGrant(requestGrantId, userId);
            } catch (err) {
              logWarn("Failed to revoke grant after upstream 401", {
                loggerScope: ["cloudflare", "mcp-handler"],
                extra: {
                  error: String(err),
                  clientId,
                  userId,
                  grantId: requestGrantId,
                },
              });
            }
          })(),
        );
      },
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
