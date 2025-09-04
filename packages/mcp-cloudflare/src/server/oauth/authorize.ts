import { Hono } from "hono";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { logger } from "@sentry/cloudflare";
import {
  renderApprovalDialog,
  parseRedirectApproval,
} from "../lib/approval-dialog";
import type { Env } from "../types";
import { SENTRY_AUTH_URL } from "./constants";
import { getUpstreamAuthorizeUrl } from "./helpers";
import { SCOPES } from "../../constants";

/**
 * Extended AuthRequest that includes permissions
 */
interface AuthRequestWithPermissions extends AuthRequest {
  permissions?: unknown;
}

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

// Export Hono app for /authorize endpoints
export default new Hono<{ Bindings: Env }>()
  /**
   * OAuth Authorization Endpoint (GET /oauth/authorize)
   *
   * This route initiates the OAuth flow when a user wants to log in.
   */
  .get("/", async (c) => {
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

    // XXX(dcramer): we want to confirm permissions on each time
    // so you can always choose new ones
    // This shouldn't be highly visible to users, as clients should use refresh tokens
    // behind the scenes.
    //
    // because we share a clientId with the upstream provider, we need to ensure that the
    // downstream client has been approved by the end-user (e.g. for a new client)
    // https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/265
    // const isApproved = await clientIdAlreadyApproved(
    //   c.req.raw,
    //   clientId,
    //   c.env.COOKIE_SECRET,
    // );
    // if (isApproved) {
    //   return redirectToUpstream(c.env, c.req.raw, oauthReqInfo);
    // }

    return renderApprovalDialog(c.req.raw, {
      client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
      server: {
        name: "Sentry MCP",
      },
      state: { oauthReqInfo }, // arbitrary data that flows through the form submission below
    });
  })

  /**
   * OAuth Authorization Endpoint (POST /oauth/authorize)
   *
   * This route handles the approval form submission and redirects to Sentry.
   */
  .post("/", async (c) => {
    // Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
    let result: Awaited<ReturnType<typeof parseRedirectApproval>>;
    try {
      result = await parseRedirectApproval(c.req.raw, c.env.COOKIE_SECRET);
    } catch (err) {
      logger.warn(`Failed to parse approval form: ${err}`, {
        error: String(err),
      });
      return c.text("Invalid request", 400);
    }

    const { state, headers, permissions } = result;

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
  });
