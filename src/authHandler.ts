import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Props } from "./types";
import { SentryApiService } from "./lib/sentry-api";
import type { z } from "zod";
import { TokenResponseSchema } from "./schema";

const SENTRY_AUTH_URL = "https://sentry.io/oauth/authorize/";
const SENTRY_TOKEN_URL = "https://sentry.io/oauth/token/";

/**
 * Constructs an authorization URL for an upstream service.
 *
 * @param {Object} options
 * @param {string} options.upstream_url - The base URL of the upstream service.
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} [options.state] - The state parameter.
 *
 * @returns {string} The authorization URL.
 */
export function getUpstreamAuthorizeUrl({
  upstream_url,
  client_id,
  scope,
  redirect_uri,
  state,
}: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}) {
  const upstream = new URL(upstream_url);
  upstream.searchParams.set("client_id", client_id);
  upstream.searchParams.set("redirect_uri", redirect_uri);
  upstream.searchParams.set("scope", scope);
  if (state) upstream.searchParams.set("state", state);
  upstream.searchParams.set("response_type", "code");
  return upstream.href;
}

/**
 * Fetches an authorization token from an upstream service.
 *
 * @param {Object} options
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.client_secret - The client secret of the application.
 * @param {string} options.code - The authorization code.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} options.upstream_url - The token endpoint URL of the upstream service.
 *
 * @returns {Promise<[string, null] | [null, Response]>} A promise that resolves to an array containing the access token or an error response.
 */
export async function exchangeCodeForAccessToken({
  client_id,
  client_secret,
  code,
  redirect_uri,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  redirect_uri: string;
  client_id: string;
}): Promise<[z.infer<typeof TokenResponseSchema>, null] | [null, Response]> {
  if (!code) {
    return [null, new Response("Missing code", { status: 400 })];
  }

  const resp = await fetch(upstream_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      client_secret,
      code,
      // redirect_uri,
    }).toString(),
  });
  if (!resp.ok) {
    console.log(await resp.text());
    return [
      null,
      new Response("Failed to fetch access token", { status: 500 }),
    ];
  }

  try {
    const body = await resp.json();

    const output = TokenResponseSchema.parse(body);

    return [output, null];
  } catch (e) {
    console.error("Failed to parse token response", e);
    return [
      null,
      new Response("Failed to parse token response", { status: 500 }),
    ];
  }
}

export default new Hono<{
  Bindings: Env & {
    OAUTH_PROVIDER: OAuthHelpers;
    SENTRY_CLIENT_ID: string;
    SENTRY_CLIENT_SECRET: string;
  };
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
    const orgsList = await apiService.listOrganizations();
    if (!orgsList.length) {
      return c.text("No organizations found", 400);
    }

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
        organizationSlug: orgsList[0].slug,
      } as Props,
    });

    return Response.redirect(redirectTo);
  });
