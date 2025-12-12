/**
 * MCP Server Worker
 *
 * Handles MCP protocol requests, OAuth flows, and executes tools.
 *
 * Routes handled:
 * - /mcp/:org?/:project? - MCP protocol (via createMcpHandler)
 * - /.mcp/* - MCP metadata (tools.json)
 * - /oauth/* - OAuth endpoints (authorize, callback)
 * - /.well-known/* - OAuth discovery
 * - /robots.txt, /llms.txt - SEO/LLM directives
 */

import { Hono } from "hono";
import { createMcpHandler } from "agents/mcp";
import { buildServer } from "@sentry/mcp-core/server";
import { parseSkills } from "@sentry/mcp-core/skills";
import { logWarn } from "@sentry/mcp-core/telem/logging";
import type { ServerContext } from "@sentry/mcp-core/types";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types.js";
import { verifyConstraintsAccess } from "./lib/constraint-utils.js";
import mcpMetadataRoutes from "./routes/mcp.js";
import oauthRoutes from "./oauth/routes/index.js";
import { tokenExchangeCallback } from "./oauth/helpers.js";
import { SCOPES } from "./oauth/constants.js";

/**
 * ExecutionContext with OAuth props injected by the OAuth provider.
 */
type OAuthExecutionContext = ExecutionContext & {
  props?: Record<string, unknown>;
};

/**
 * Create the Hono app with all routes
 */
function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // SEO/LLM directives
  app.get("/robots.txt", (c) => {
    return c.text(["User-agent: *", "Allow: /$", "Disallow: /"].join("\n"));
  });

  app.get("/llms.txt", (c) => {
    return c.text(
      [
        "# sentry-mcp",
        "",
        "This service implements the Model Context Protocol for interacting with Sentry (https://sentry.io/welcome/).",
        "",
        `The MCP's server address is: ${new URL("/mcp", c.req.url).href}`,
        "",
      ].join("\n"),
    );
  });

  // MCP metadata routes (/.mcp/*)
  app.route("/.mcp", mcpMetadataRoutes);

  // OAuth routes (/oauth/*)
  app.route("/oauth", oauthRoutes);

  // Well-known OAuth metadata endpoint
  app.get("/.well-known/oauth-authorization-server", (c) => {
    const baseUrl = new URL(c.req.url).origin;
    return c.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  // SSE deprecation notice
  app.get("/sse", (c) => {
    return c.json(
      {
        error: "SSE transport has been removed",
        message:
          "The SSE transport endpoint is no longer supported. Please use the HTTP transport at /mcp instead.",
        migrationGuide: "https://mcp.sentry.dev",
      },
      410,
    );
  });

  return app;
}

/**
 * MCP Handler that processes authenticated requests
 *
 * Extracts auth props from ExecutionContext (set by OAuth provider),
 * parses constraints from URL, and builds MCP server with context.
 */
async function handleMcpRequest(
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

  // Parse and validate granted skills (primary authorization method)
  // Legacy tokens without grantedSkills are no longer supported
  if (!oauthCtx.props.grantedSkills) {
    const userId = oauthCtx.props.id as string;
    const clientId = oauthCtx.props.clientId as string;

    logWarn("Legacy token without grantedSkills detected - revoking grant", {
      loggerScope: ["cloudflare", "server", "mcp-handler"],
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
            loggerScope: ["cloudflare", "server", "mcp-handler"],
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
      loggerScope: ["cloudflare", "server", "mcp-handler"],
      extra: {
        invalidSkills,
      },
    });
  }

  // Validate that at least one valid skill was granted
  if (validSkills.size === 0) {
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
  };

  // Create and configure MCP server with tools filtered by context
  // Context is captured in tool handler closures during buildServer()
  const server = buildServer({
    context: serverContext,
    agentMode: isAgentMode,
  });

  // Run MCP handler - context already captured in closures
  return createMcpHandler(server, {
    route: url.pathname,
  })(request, env, ctx);
}

// Create the Hono app for handling routes
const app = createApp();

/**
 * MCP Handler wrapped as ExportedHandler for OAuthProvider
 */
const mcpHandler = {
  fetch: async (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> => {
    const url = new URL(request.url);

    // Route MCP protocol requests to the handler
    if (url.pathname.startsWith("/mcp")) {
      return handleMcpRequest(request, env, ctx);
    }

    // Route all other requests to Hono app
    return app.fetch(request, env, ctx);
  },
};

/**
 * Create an OAuth provider wrapper for request handling
 *
 * This wraps the MCP handler with OAuth validation, so tokens are
 * automatically validated and props are injected into ExecutionContext.
 */
const oauthProviderHandler = {
  fetch: async (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> => {
    const oAuthProvider = new OAuthProvider({
      // MCP protocol routes require authentication
      apiRoute: "/mcp",
      // @ts-expect-error - OAuthProvider types don't support specific Env types
      apiHandler: mcpHandler,
      // All other routes don't require auth (metadata, robots.txt, OAuth, etc.)
      // @ts-expect-error - OAuthProvider types don't support specific Env types
      defaultHandler: app,
      // OAuth endpoints handled by our Hono routes
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      // Token refresh callback to handle upstream Sentry token refresh
      tokenExchangeCallback: (options) => tokenExchangeCallback(options, env),
      scopesSupported: Object.keys(SCOPES),
    });

    return oAuthProvider.fetch(request, env, ctx);
  },
};

/**
 * Default export for HTTP handling
 */
export default oauthProviderHandler;
