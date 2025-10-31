import { Hono } from "hono";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { clientIdAlreadyApproved } from "../../lib/approval-dialog";
import type { Env, WorkerProps } from "../../types";
import type { Scope } from "@sentry/mcp-server/permissions";
import { DEFAULT_SCOPES } from "@sentry/mcp-server/constants";
import { SENTRY_TOKEN_URL } from "../constants";
import {
  exchangeCodeForAccessToken,
  validateResourceParameter,
} from "../helpers";
import { verifyAndParseState, type OAuthState } from "../state";
import { logWarn } from "@sentry/mcp-server/telem/logging";

/**
 * Extended AuthRequest that includes permissions and resource parameter
 */
interface AuthRequestWithPermissions extends AuthRequest {
  permissions?: unknown;
  resource?: string;
}

/**
 * Convert selected permissions to granted scopes
 * Permissions are additive:
 * - Base (always included): org:read, project:read, team:read, event:read
 * - Seer adds: seer (virtual scope)
 * - Docs adds: docs (virtual scope)
 * - Issue Triage adds: event:write
 * - Project Management adds: project:write, team:write
 * @param permissions Array of permission strings
 */
function getScopesFromPermissions(permissions?: unknown): Set<Scope> {
  // Start with base read-only scopes (always granted via DEFAULT_SCOPES)
  const scopes = new Set<Scope>(DEFAULT_SCOPES);

  // Validate permissions is an array of strings
  if (!Array.isArray(permissions) || permissions.length === 0) {
    return scopes;
  }
  const perms = (permissions as unknown[]).filter(
    (p): p is string => typeof p === "string",
  );

  // Add scopes based on selected permissions
  if (perms.includes("seer")) {
    scopes.add("seer");
  }

  if (perms.includes("docs")) {
    scopes.add("docs");
  }

  if (perms.includes("issue_triage")) {
    scopes.add("event:write");
  }

  if (perms.includes("project_management")) {
    scopes.add("project:write");
    scopes.add("team:write");
  }

  return scopes;
}

/**
 * OAuth Callback Endpoint (GET /oauth/callback)
 *
 * This route handles the callback from Sentry after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
// Export Hono app for /callback endpoint
export default new Hono<{ Bindings: Env }>().get("/", async (c) => {
  // Verify and parse the signed state
  let parsedState: OAuthState;
  try {
    const rawState = c.req.query("state") ?? "";
    parsedState = await verifyAndParseState(rawState, c.env.COOKIE_SECRET);
  } catch (err) {
    logWarn("Invalid state received on OAuth callback", {
      loggerScope: ["cloudflare", "oauth", "callback"],
      extra: { error: String(err) },
    });
    return c.text("Invalid state", 400);
  }

  // Reconstruct oauth request info exactly as provided by downstream client
  const oauthReqInfo = parsedState.req as unknown as AuthRequestWithPermissions;

  if (!oauthReqInfo.clientId) {
    logWarn("Missing clientId in OAuth state", {
      loggerScope: ["cloudflare", "oauth", "callback"],
    });
    return c.text("Invalid state", 400);
  }

  // Validate redirectUri is a valid URL
  if (!oauthReqInfo.redirectUri) {
    logWarn("Missing redirectUri in OAuth state", {
      loggerScope: ["cloudflare", "oauth", "callback"],
    });
    return c.text("Authorization failed: No redirect URL provided", 400);
  }

  try {
    new URL(oauthReqInfo.redirectUri);
  } catch (err) {
    logWarn(`Invalid redirectUri in OAuth state: ${oauthReqInfo.redirectUri}`, {
      loggerScope: ["cloudflare", "oauth", "callback"],
      extra: { error: String(err) },
    });
    return c.text("Authorization failed: Invalid redirect URL", 400);
  }

  // Validate resource parameter per RFC 8707
  const resourceFromState = oauthReqInfo.resource;

  if (
    resourceFromState &&
    !validateResourceParameter(resourceFromState, c.req.url)
  ) {
    logWarn("Invalid resource parameter in callback", {
      loggerScope: ["cloudflare", "oauth", "callback"],
      extra: {
        resource: resourceFromState,
        clientId: oauthReqInfo.clientId,
      },
    });

    return c.text("Authorization failed: Invalid resource parameter", 400);
  }

  // because we share a clientId with the upstream provider, we need to ensure that the
  // downstream client has been approved by the end-user (e.g. for a new client)
  // https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/265
  const isApproved = await clientIdAlreadyApproved(
    c.req.raw,
    oauthReqInfo.clientId,
    c.env.COOKIE_SECRET,
  );
  if (!isApproved) {
    return c.text("Authorization failed: Client not approved", 403);
  }

  // Validate redirectUri is registered for this client
  try {
    const client = await c.env.OAUTH_PROVIDER.lookupClient(
      oauthReqInfo.clientId,
    );
    const uriIsAllowed =
      Array.isArray(client?.redirectUris) &&
      client.redirectUris.includes(oauthReqInfo.redirectUri);
    if (!uriIsAllowed) {
      logWarn("Redirect URI not registered for client on callback", {
        loggerScope: ["cloudflare", "oauth", "callback"],
        extra: {
          clientId: oauthReqInfo.clientId,
          redirectUri: oauthReqInfo.redirectUri,
        },
      });
      return c.text("Authorization failed: Invalid redirect URL", 400);
    }
  } catch (lookupErr) {
    logWarn("Failed to validate client redirect URI on callback", {
      loggerScope: ["cloudflare", "oauth", "callback"],
      extra: { error: String(lookupErr) },
    });
    return c.text("Authorization failed: Invalid redirect URL", 400);
  }

  // Exchange the code for an access token
  // Note: redirect_uri must match the one used in the authorization request
  // This is the Sentry callback URL, not the downstream MCP client's redirect URI
  const sentryCallbackUrl = new URL("/oauth/callback", c.req.url).href;
  const [payload, errResponse] = await exchangeCodeForAccessToken({
    upstream_url: new URL(
      SENTRY_TOKEN_URL,
      `https://${c.env.SENTRY_HOST || "sentry.io"}`,
    ).href,
    client_id: c.env.SENTRY_CLIENT_ID,
    client_secret: c.env.SENTRY_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: sentryCallbackUrl,
  });
  if (errResponse) return errResponse;

  // Get scopes based on selected permissions
  const grantedScopes = getScopesFromPermissions(oauthReqInfo.permissions);

  // Return back to the MCP client a new token
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo as AuthRequest,
    userId: payload.user.id,
    metadata: {
      label: payload.user.name,
    },
    scope: oauthReqInfo.scope,
    // Props are available via ExecutionContext.props in the MCP handler
    props: {
      // OAuth standard fields
      id: payload.user.id,

      // Sentry-specific fields
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      // Cache upstream expiry so future refresh grants can avoid
      // unnecessary upstream refresh calls when still valid
      accessTokenExpiresAt: Date.now() + payload.expires_in * 1000,
      clientId: oauthReqInfo.clientId,
      scope: oauthReqInfo.scope.join(" "),
      grantedScopes: Array.from(grantedScopes),

      // Note: constraints are NOT included here - they're extracted per-request from URL
      // Note: sentryHost and mcpUrl come from env, not OAuth props
    } as WorkerProps,
  });

  // Use manual redirect instead of Response.redirect() to allow middleware to add headers
  return c.redirect(redirectTo);
});
