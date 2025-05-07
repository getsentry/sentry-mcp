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
  renderApprovalDialog,
  clientIdAlreadyApproved,
  parseRedirectApproval,
} from "../lib/approval-dialog";

export const SENTRY_AUTH_URL = "/oauth/authorize/";
export const SENTRY_TOKEN_URL = "/oauth/token/";

async function redirectToUpstream(
  env: Env,
  request: Request,
  oauthReqInfo: AuthRequest,
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

export default new Hono<{
  Bindings: Env;
}>()
  /**
   * OAuth Authorization Endpoint
   *
   * This route initiates the GitHub OAuth flow when a user wants to log in.
   * It creates a random state parameter to prevent CSRF attacks and stores the
   * original OAuth request information in KV storage for later retrieval.
   * Then it redirects the user to GitHub's authorization page with the appropriate
   * parameters so the user can authenticate and grant permissions.
   */
  // TODO: this needs to deauthorize if props are not correct (e.g. wrong org slug)
  .get("/authorize", async (c) => {
    const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
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
    const { state, headers } = await parseRedirectApproval(
      c.req.raw,
      c.env.COOKIE_SECRET,
    );
    if (!state.oauthReqInfo) {
      return c.text("Invalid request", 400);
    }

    return redirectToUpstream(c.env, c.req.raw, state.oauthReqInfo, headers);
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
    const oauthReqInfo = JSON.parse(
      atob(c.req.query("state") as string),
    ) as AuthRequest;
    if (!oauthReqInfo.clientId) {
      return c.text("Invalid state", 400);
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

    // Get organizations using the SentryApiService
    const apiService = new SentryApiService({
      host: c.env.SENTRY_HOST,
      accessToken: payload.access_token,
    });
    const orgsList = await apiService.listOrganizations();

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
        organizationSlug: orgsList.length ? orgsList[0].slug : null,
        clientId: oauthReqInfo.clientId,
        scope: oauthReqInfo.scope.join(" "),
      } as WorkerProps,
    });

    return Response.redirect(redirectTo);
  });
