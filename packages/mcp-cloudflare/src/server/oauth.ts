import { z } from "zod";
import { logError } from "@sentry/mcp-server/logging";
export const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(), // should be "bearer"
  expires_in: z.number(),
  expires_at: z.string().datetime(),
  user: z.object({
    email: z.string().email(),
    id: z.string(),
    name: z.string(),
  }),
  scope: z.string(),
});

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
 * @param {string} options.upstream_url - The token endpoint URL of the upstream service.
 *
 * @returns {Promise<[string, null] | [null, Response]>} A promise that resolves to an array containing the access token or an error response.
 */
export async function exchangeCodeForAccessToken({
  client_id,
  client_secret,
  code,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  client_id: string;
}): Promise<[z.infer<typeof TokenResponseSchema>, null] | [null, Response]> {
  if (!code) {
    logError("[oauth] Missing code in token exchange", {
      oauth: {
        client_id,
      },
    });
    return [
      null,
      new Response("Invalid request: missing authorization code", {
        status: 400,
      }),
    ];
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
    }).toString(),
  });
  if (!resp.ok) {
    logError(
      `[oauth] Failed to exchange code for access token: ${await resp.text()}`,
      {
        oauth: {
          client_id,
        },
      },
    );
    return [
      null,
      new Response(
        "There was an issue authenticating your account and retrieving an access token. Please try again.",
        { status: 400 },
      ),
    ];
  }

  try {
    const body = await resp.json();

    const output = TokenResponseSchema.parse(body);

    return [output, null];
  } catch (e) {
    logError(
      new Error("Failed to parse token response", {
        cause: e,
      }),
      {
        oauth: {
          client_id,
        },
      },
    );
    return [
      null,
      new Response(
        "There was an issue authenticating your account and retrieving an access token. Please try again.",
        { status: 500 },
      ),
    ];
  }
}
