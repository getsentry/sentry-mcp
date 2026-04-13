import { z } from "zod";

/**
 * Response from Sentry's device code endpoint (POST /oauth/device/code/).
 * See: https://docs.sentry.io/api/auth/#device-authorization-flow
 */
export const DeviceCodeResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url(),
  interval: z.number().int().positive(),
  expires_in: z.number().int().positive(),
});

export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponseSchema>;

/**
 * Error response during device code token polling.
 */
export const DeviceCodeErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

/**
 * Successful token response from Sentry's token endpoint.
 * Mirrors the shape used by the cloudflare OAuth callback.
 */
export const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().nullable(),
  token_type: z.string(),
  expires_in: z.number().nullable(),
  expires_at: z.string().datetime().nullable(),
  user: z.object({
    email: z.string().nullable().optional(),
    id: z.string(),
    name: z.string().nullable(),
  }),
  scope: z.string(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

/**
 * Shape of a cached token entry stored on disk.
 */
export type CachedToken = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  sentry_host: string;
  client_id: string;
  // Historical name retained for cache compatibility; this stores a user label,
  // not necessarily an email address.
  user_email: string;
  scope: string;
};

export function getTokenUserLabel(tokenResponse: TokenResponse): string {
  return (
    tokenResponse.user.name ?? tokenResponse.user.email ?? tokenResponse.user.id
  );
}

function getTokenExpiresAt(tokenResponse: TokenResponse): string | null {
  if (tokenResponse.expires_at) {
    return tokenResponse.expires_at;
  }

  if (typeof tokenResponse.expires_in === "number") {
    return new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
  }

  return null;
}

export function toCachedToken(
  tokenResponse: TokenResponse,
  sentryHost: string,
  clientId: string,
) {
  const expiresAt = getTokenExpiresAt(tokenResponse);
  if (!expiresAt) {
    return null;
  }

  return {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at: expiresAt,
    sentry_host: sentryHost,
    client_id: clientId,
    user_email: getTokenUserLabel(tokenResponse),
    scope: tokenResponse.scope,
  };
}
