import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";

import {
  exchangeCodeForAccessToken,
  getUpstreamAuthorizeUrl,
} from "../lib/oauth";
import type { Env, WorkerProps } from "../types";
import { SentryApiService } from "@sentry/mcp-server/api-client";
import { SCOPES } from "../../constants";
import {
  PermissionLevel,
  getScopesForPermissionLevel,
  type Scope,
} from "@sentry/mcp-server/permissions";
import {
  renderApprovalDialog,
  clientIdAlreadyApproved,
  parseRedirectApproval,
} from "../lib/approval-dialog";

/**
 * Extended AuthRequest that includes permissions
 */
interface AuthRequestWithPermissions extends AuthRequest {
  permissions?: {
    issueTriageEnabled: boolean;
    projectManagementEnabled: boolean;
  };
}

/**
 * Convert permission checkboxes to a permission level
 * Read-only is always included, checkboxes add additional capabilities
 */
function getPermissionLevelFromCheckboxes(permissions?: {
  issueTriageEnabled: boolean;
  projectManagementEnabled: boolean;
}): PermissionLevel {
  if (!permissions) {
    // Default to full permissions for backward compatibility
    return PermissionLevel.PROJECT_MANAGEMENT;
  }

  // If project management is enabled, it includes all capabilities
  if (permissions.projectManagementEnabled) {
    return PermissionLevel.PROJECT_MANAGEMENT;
  }

  // If only issue triage is enabled, that's the level
  if (permissions.issueTriageEnabled) {
    return PermissionLevel.ISSUE_TRIAGE;
  }

  // Default to read-only (always included)
  return PermissionLevel.READ_ONLY;
}
import { logger } from "@sentry/cloudflare";

export const SENTRY_AUTH_URL = "/oauth/authorize/";
export const SENTRY_TOKEN_URL = "/oauth/token/";

async function redirectToUpstream(
  env: Env,
  request: Request,
  oauthReqInfo: AuthRequest | AuthRequestWithPermissions,
  headers: Record<string, string> = {},
) {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        upstream_url: new URL(
          SENTRY_AUTH_URL,
          `https://${env.SENTRY_HOST || "sentry.io"}`,
        ).href,
        scope: Object.keys(SCOPES).join(" "),
        client_id: env.SENTRY_CLIENT_ID,
        redirect_uri: new URL("/oauth/callback", request.url).href,
        state: btoa(JSON.stringify(oauthReqInfo)),
      }),
    },
  });
}

// Create OAuth router - security middleware is applied at the app level
export default new Hono<{
  Bindings: Env;
}>()
  /**
   * OAuth Authorization Endpoint
   *
   * This route initiates the OAuth flow when a user wants to log in.
   */
  // TODO: this needs to deauthorize if props are not correct (e.g. wrong org slug)
  .get("/authorize", async (c) => {
    let oauthReqInfo: AuthRequest;
    try {
      oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
    } catch (err) {
      // Log invalid redirect URI errors without sending them to Sentry
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("Invalid redirect URI")) {
        logger.warn(`OAuth authorization failed: ${errorMessage}`, {
          error: errorMessage,
          // Don't include the full error object to prevent Sentry capture
        });
        return c.text("Invalid redirect URI", 400);
      }
      // Re-throw other errors to be captured by Sentry
      throw err;
    }

    const { clientId } = oauthReqInfo;
    if (!clientId) {
      return c.text("Invalid request", 400);
    }

    // because we share a clientId with the upstream provider, we need to ensure that the
    // downstream client has been approved by the end-user (e.g. for a new client)
    // https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/265
    const isApproved = await clientIdAlreadyApproved(
      c.req.raw,
      clientId,
      c.env.COOKIE_SECRET,
    );
    if (!isApproved) {
      return renderApprovalDialog(c.req.raw, {
        client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
        server: {
          name: "Sentry MCP",
        },
        state: { oauthReqInfo }, // arbitrary data that flows through the form submission below
      });
    }

    return redirectToUpstream(c.env, c.req.raw, oauthReqInfo);
  })

  .post("/authorize", async (c) => {
    // Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
    const { state, headers, permissions } = await parseRedirectApproval(
      c.req.raw,
      c.env.COOKIE_SECRET,
    );
    if (!state.oauthReqInfo) {
      return c.text("Invalid request", 400);
    }

    // Store the selected permissions in the OAuth request info
    // This will be passed through to the callback via the state parameter
    const oauthReqWithPermissions = {
      ...state.oauthReqInfo,
      permissions,
    };

    return redirectToUpstream(
      c.env,
      c.req.raw,
      oauthReqWithPermissions,
      headers,
    );
  })

  /**
   * OAuth Callback Endpoint
   *
   * This route handles the callback from GitHub after user authentication.
   * It exchanges the temporary code for an access token, then stores some
   * user metadata & the auth token as part of the 'props' on the token passed
   * down to the client. It ends by redirecting the client back to _its_ callback URL
   */
  .get("/callback", async (c) => {
    // Get the oathReqInfo out of KV
    let oauthReqInfo: AuthRequestWithPermissions;
    try {
      oauthReqInfo = JSON.parse(
        atob(c.req.query("state") as string),
      ) as AuthRequestWithPermissions;
    } catch (err) {
      logger.warn(`Invalid state: ${c.req.query("state") as string}`, {
        error: String(err),
      });
      return c.text("Invalid state", 400);
    }
    if (!oauthReqInfo.clientId) {
      return c.text("Invalid state", 400);
    }

    // Validate redirectUri is a valid URL
    if (!oauthReqInfo.redirectUri) {
      logger.warn("Missing redirectUri in OAuth state");
      return c.text("Authorization failed: No redirect URL provided", 400);
    }

    try {
      new URL(oauthReqInfo.redirectUri);
    } catch (err) {
      logger.warn(
        `Invalid redirectUri in OAuth state: ${oauthReqInfo.redirectUri}`,
        {
          error: String(err),
        },
      );
      return c.text("Authorization failed: Invalid redirect URL", 400);
    }

    // Exchange the code for an access token
    const [payload, errResponse] = await exchangeCodeForAccessToken({
      upstream_url: new URL(
        SENTRY_TOKEN_URL,
        `https://${c.env.SENTRY_HOST || "sentry.io"}`,
      ).href,
      client_id: c.env.SENTRY_CLIENT_ID,
      client_secret: c.env.SENTRY_CLIENT_SECRET,
      code: c.req.query("code"),
    });
    if (errResponse) return errResponse;

    // Use permissions from the approval dialog, or default to full permissions for backward compatibility
    const permissionLevel = getPermissionLevelFromCheckboxes(
      oauthReqInfo.permissions,
    );
    const grantedScopes = getScopesForPermissionLevel(permissionLevel);

    // Return back to the MCP client a new token
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: payload.user.id,
      metadata: {
        label: payload.user.name,
      },
      scope: oauthReqInfo.scope,
      // This will be available on this.props inside MyMCP
      props: {
        id: payload.user.id,
        name: payload.user.name,
        accessToken: payload.access_token,
        clientId: oauthReqInfo.clientId,
        scope: oauthReqInfo.scope.join(" "),
        grantedScopes: Array.from(grantedScopes),
      } as WorkerProps,
    });

    // Use manual redirect instead of Response.redirect() to allow middleware to add headers
    return c.redirect(redirectTo);
  });
