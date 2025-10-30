import { Hono } from "hono";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import {
  renderApprovalDialog,
  parseRedirectApproval,
} from "../../lib/approval-dialog";
import type { Env } from "../../types";
import { SENTRY_AUTH_URL } from "../constants";
import {
  getUpstreamAuthorizeUrl,
  validateResourceParameter,
  createResourceValidationError,
} from "../helpers";
import { SCOPES } from "../../../constants";
import { signState, type OAuthState } from "../state";
import { logWarn } from "@sentry/mcp-server/telem/logging";

/**
 * Extended AuthRequest that includes skills and resource parameter
 */
interface AuthRequestWithSkills extends AuthRequest {
  skills?: unknown;
  resource?: string;
}

async function redirectToUpstream(
  env: Env,
  request: Request,
  oauthReqInfo: AuthRequest | AuthRequestWithSkills,
  headers: Record<string, string> = {},
  stateOverride?: string,
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
        state: stateOverride ?? btoa(JSON.stringify(oauthReqInfo)),
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
        logWarn(`OAuth authorization failed: ${errorMessage}`, {
          loggerScope: ["cloudflare", "oauth", "authorize"],
          extra: { error: errorMessage },
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

    // Validate resource parameter per RFC 8707
    const requestUrl = new URL(c.req.url);
    const resourceParam = requestUrl.searchParams.get("resource");

    if (
      resourceParam !== null &&
      !validateResourceParameter(resourceParam, c.req.url)
    ) {
      logWarn("Invalid resource parameter in authorization request", {
        loggerScope: ["cloudflare", "oauth", "authorize"],
        extra: {
          resource: resourceParam,
          requestUrl: c.req.url,
          clientId,
        },
      });

      const redirectUri = requestUrl.searchParams.get("redirect_uri");
      const state = requestUrl.searchParams.get("state");

      if (redirectUri) {
        return createResourceValidationError(redirectUri, state ?? undefined);
      }

      return c.text("Invalid resource parameter", 400);
    }

    // Preserve resource in state, not exported upstream
    const oauthReqInfoWithResource: AuthRequestWithSkills = {
      ...oauthReqInfo,
      ...(resourceParam ? { resource: resourceParam } : {}),
    };

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
      state: { oauthReqInfo: oauthReqInfoWithResource },
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
      logWarn("Failed to parse approval form", {
        loggerScope: ["cloudflare", "oauth", "authorize"],
        extra: { error: String(err) },
      });
      return c.text("Invalid request", 400);
    }

    const { state, headers, skills } = result;

    if (!state.oauthReqInfo) {
      return c.text("Invalid request", 400);
    }

    // Store the selected skills in the OAuth request info
    // This will be passed through to the callback via the state parameter
    const oauthReqWithSkills = {
      ...state.oauthReqInfo,
      skills,
    };

    // Validate redirectUri first to prevent open redirects from error responses
    try {
      const client = await c.env.OAUTH_PROVIDER.lookupClient(
        oauthReqWithSkills.clientId,
      );
      const uriIsAllowed =
        Array.isArray(client?.redirectUris) &&
        client.redirectUris.includes(oauthReqWithSkills.redirectUri);
      if (!uriIsAllowed) {
        logWarn("Redirect URI not registered for client", {
          loggerScope: ["cloudflare", "oauth", "authorize"],
          extra: {
            clientId: oauthReqWithSkills.clientId,
            redirectUri: oauthReqWithSkills.redirectUri,
          },
        });
        return c.text("Invalid redirect URI", 400);
      }
    } catch (lookupErr) {
      logWarn("Failed to validate client redirect URI", {
        loggerScope: ["cloudflare", "oauth", "authorize"],
        extra: { error: String(lookupErr) },
      });
      return c.text("Invalid request", 400);
    }

    // Validate resource parameter (RFC 8707)
    const resourceFromState = oauthReqWithSkills.resource;
    if (
      resourceFromState !== undefined &&
      !validateResourceParameter(resourceFromState, c.req.url)
    ) {
      logWarn("Invalid resource parameter in authorization approval", {
        loggerScope: ["cloudflare", "oauth", "authorize"],
        extra: {
          resource: resourceFromState,
          clientId: oauthReqWithSkills.clientId,
        },
      });

      return createResourceValidationError(
        oauthReqWithSkills.redirectUri,
        oauthReqWithSkills.state,
      );
    }

    // Build signed state for redirect to Sentry (10 minute validity)
    const now = Date.now();
    const payload: OAuthState = {
      req: oauthReqWithSkills as unknown as Record<string, unknown>,
      iat: now,
      exp: now + 10 * 60 * 1000,
    };
    const signedState = await signState(payload, c.env.COOKIE_SECRET);

    return redirectToUpstream(
      c.env,
      c.req.raw,
      oauthReqWithSkills,
      headers,
      signedState,
    );
  });
