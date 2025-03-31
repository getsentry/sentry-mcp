import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { exchangeCodeForAccessToken, getUpstreamAuthorizeUrl } from "./utils";
import type { Props } from "./types";
import { SentryApiService } from "./sentry-api";
import { Env } from "./types";

const SENTRY_AUTH_URL = "https://sentry.io/oauth/authorize/";
const SENTRY_TOKEN_URL = "https://sentry.io/oauth/token/";

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
    if (!oauthReqInfo.clientId) {
      return c.text("Invalid request", 400);
    }

    return Response.redirect(
      getUpstreamAuthorizeUrl({
        upstream_url: SENTRY_AUTH_URL,
        scope: "org:read project:read event:read",
        client_id: c.env.SENTRY_CLIENT_ID,
        redirect_uri: new URL("/callback", c.req.url).href,
        state: btoa(JSON.stringify(oauthReqInfo)),
      })
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
    const oauthReqInfo = JSON.parse(
      atob(c.req.query("state") as string)
    ) as AuthRequest;
    if (!oauthReqInfo.clientId) {
      return c.text("Invalid state", 400);
    }

    // Exchange the code for an access token
    const [payload, errResponse] = await exchangeCodeForAccessToken({
      upstream_url: SENTRY_TOKEN_URL,
      client_id: c.env.SENTRY_CLIENT_ID,
      client_secret: c.env.SENTRY_CLIENT_SECRET,
      code: c.req.query("code"),
      redirect_uri: new URL("/callback", c.req.url).href,
    });
    if (errResponse) return errResponse;

    // Get organizations using the SentryApiService
    const apiService = new SentryApiService(payload.access_token);
    const orgsList = await apiService.getOrganizations();
    if (!orgsList.length) {
      return c.text("No organizations found", 400);
    }

    const userId = payload.user.id;

    const doId = c.env.USER_CONTEXT.idFromName(userId);
    const userContext = c.env.USER_CONTEXT.get(doId);
    await userContext.addClientId(oauthReqInfo.clientId, orgsList[0].slug);

    // Return back to the MCP client a new token
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId,
      metadata: {
        label: payload.user.name,
      },
      scope: oauthReqInfo.scope,
      // This will be available on this.props inside SentryMCP
      props: {
        id: userId,
        name: payload.user.name,
        accessToken: payload.access_token,
        organizationSlug: orgsList[0].slug,
      } satisfies Props,
    });

    return Response.redirect(redirectTo);
  });
