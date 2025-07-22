import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { SCOPES } from "../../constants";
import type { Env } from "../types";
import { createErrorPage, createSuccessPage } from "../lib/html-utils";
import { logError } from "@sentry/mcp-server/logging";

// Generate a secure random state parameter using Web Crypto API
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

// Check if we're in development environment
function isDevelopmentEnvironment(url: string): boolean {
  const parsedUrl = new URL(url);
  return (
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1" ||
    parsedUrl.hostname.endsWith(".local") ||
    parsedUrl.hostname.endsWith(".localhost")
  );
}

// Get secure cookie options based on environment
export function getSecureCookieOptions(url: string, maxAge?: number) {
  const isDev = isDevelopmentEnvironment(url);
  return {
    httpOnly: true,
    secure: !isDev, // HTTPS in production, allow HTTP in development
    sameSite: "Lax" as const, // Strict since OAuth flow is same-domain
    path: "/", // Available across all paths
    ...(maxAge && { maxAge }), // Optional max age
  };
}

// OAuth client registration schemas (RFC 7591)
const ClientRegistrationRequestSchema = z.object({
  client_name: z.string(),
  client_uri: z.string().optional(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  scope: z.string(),
});

type ClientRegistrationRequest = z.infer<
  typeof ClientRegistrationRequestSchema
>;

const ClientRegistrationResponseSchema = z.object({
  client_id: z.string(),
  redirect_uris: z.array(z.string()),
  client_name: z.string().optional(),
  client_uri: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  registration_client_uri: z.string().optional(),
  client_id_issued_at: z.number().optional(),
});

type ClientRegistrationResponse = z.infer<
  typeof ClientRegistrationResponseSchema
>;

// Token exchange schema - this is what the MCP server's OAuth returns
const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

type TokenResponse = z.infer<typeof TokenResponseSchema>;

// Auth data schema (same as in chat.ts)
const AuthDataSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.string(),
  token_type: z.string(),
});

// Get or register OAuth client with the MCP server
export async function getOrRegisterChatClient(
  env: Env,
  redirectUri: string,
): Promise<string> {
  const CHAT_CLIENT_REGISTRATION_KEY = "chat_oauth_client_registration";

  // Check if we already have a registered client in KV
  const existingRegistration = await env.OAUTH_KV.get(
    CHAT_CLIENT_REGISTRATION_KEY,
  );
  if (existingRegistration) {
    const registration = ClientRegistrationResponseSchema.parse(
      JSON.parse(existingRegistration),
    );
    // Verify the redirect URI matches (in case the deployment URL changed)
    if (registration.redirect_uris?.includes(redirectUri)) {
      return registration.client_id;
    }
    // If redirect URI doesn't match, we need to re-register
    console.warn("Redirect URI mismatch, re-registering chat client", {
      existing: registration.redirect_uris,
      requested: redirectUri,
    });
  }

  // Register new client with our MCP server using OAuth 2.1 dynamic client registration
  const mcpHost = new URL(redirectUri).origin;
  const registrationUrl = `${mcpHost}/oauth/register`;

  const registrationData: ClientRegistrationRequest = {
    client_name: "Sentry MCP Chat Demo",
    client_uri: "https://github.com/getsentry/sentry-mcp",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none", // PKCE, no client secret
    scope: Object.keys(SCOPES).join(" "),
  };

  const response = await fetch(registrationUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Sentry MCP Chat Demo",
    },
    body: JSON.stringify(registrationData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Client registration failed: ${response.status} - ${error}`,
    );
  }

  const registrationResponse = ClientRegistrationResponseSchema.parse(
    await response.json(),
  );

  // Store the registration in KV for future use
  await env.OAUTH_KV.put(
    CHAT_CLIENT_REGISTRATION_KEY,
    JSON.stringify(registrationResponse),
    {
      // Store for 30 days (max KV TTL)
      expirationTtl: 30 * 24 * 60 * 60,
    },
  );

  return registrationResponse.client_id;
}

// Exchange authorization code for access token
async function exchangeCodeForToken(
  env: Env,
  code: string,
  redirectUri: string,
  clientId: string,
): Promise<TokenResponse> {
  const mcpHost = new URL(redirectUri).origin;
  const tokenUrl = `${mcpHost}/oauth/token`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code: code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "Sentry MCP Chat Demo",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return TokenResponseSchema.parse(data);
}

// HTML template helpers are now imported from ../lib/html-utils

export default new Hono<{
  Bindings: Env;
}>()
  /**
   * Initiate OAuth flow for chat application
   * 1. Register with MCP server using OAuth 2.1 dynamic client registration
   * 2. Redirect to MCP server OAuth with the registered client ID
   */
  .get("/authorize", async (c) => {
    try {
      const state = generateState();
      const redirectUri = new URL("/api/auth/callback", c.req.url).href;

      // Store state in a secure cookie for CSRF protection
      setCookie(
        c,
        "chat_oauth_state",
        state,
        getSecureCookieOptions(c.req.url, 600),
      );

      // Step 1: Get or register OAuth client with MCP server
      const clientId = await getOrRegisterChatClient(c.env, redirectUri);

      // Step 2: Build authorization URL pointing to our MCP server's OAuth
      const mcpHost = new URL(c.req.url).origin;
      const authUrl = new URL("/oauth/authorize", mcpHost);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", Object.keys(SCOPES).join(" "));
      authUrl.searchParams.set("state", state);

      return c.redirect(authUrl.toString());
    } catch (error) {
      const eventId = logError(error);
      return c.json({ error: "Failed to initiate OAuth flow", eventId }, 500);
    }
  })

  /**
   * Handle OAuth callback and exchange code for access token
   */
  .get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    const storedState = getCookie(c, "chat_oauth_state");

    // Validate state parameter to prevent CSRF attacks
    if (!state || !storedState || state !== storedState) {
      deleteCookie(c, "chat_oauth_state", getSecureCookieOptions(c.req.url));
      logError("Invalid state parameter received", {
        oauth: {
          state,
          expectedState: storedState,
        },
      });
      return c.html(
        createErrorPage(
          "Authentication Failed",
          "Invalid state parameter. Please try again.",
          "Invalid state parameter",
        ),
        400,
      );
    }

    // Clear the state cookie with same options as when it was set
    deleteCookie(c, "chat_oauth_state", getSecureCookieOptions(c.req.url));

    if (!code) {
      logError("No authorization code received");
      return c.html(
        createErrorPage(
          "Authentication Failed",
          "No authorization code received. Please try again.",
          "No authorization code received",
        ),
        400,
      );
    }

    try {
      const redirectUri = new URL("/api/auth/callback", c.req.url).href;

      // Get the registered client ID
      const clientId = await getOrRegisterChatClient(c.env, redirectUri);

      // Exchange code for access token with our MCP server
      const tokenResponse = await exchangeCodeForToken(
        c.env,
        code,
        redirectUri,
        clientId,
      );

      // Store complete auth data in secure cookie
      const authData = {
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token || "", // Ensure we always have a refresh token
        expires_at: new Date(
          Date.now() + (tokenResponse.expires_in || 28800) * 1000,
        ).toISOString(),
        token_type: tokenResponse.token_type,
      };

      setCookie(
        c,
        "sentry_auth_data",
        JSON.stringify(authData),
        getSecureCookieOptions(c.req.url, 30 * 24 * 60 * 60), // 30 days max
      );

      // Return a success page - auth is now handled via cookies
      return c.html(createSuccessPage());
    } catch (error) {
      logError(error);
      return c.html(
        createErrorPage(
          "Authentication Error",
          "Failed to complete authentication. Please try again.",
          "Authentication failed",
        ),
        500,
      );
    }
  })

  /**
   * Check authentication status
   */
  .get("/status", async (c) => {
    const authDataCookie = getCookie(c, "sentry_auth_data");

    if (!authDataCookie) {
      return c.json({ authenticated: false }, 401);
    }

    try {
      AuthDataSchema.parse(JSON.parse(authDataCookie));
      return c.json({ authenticated: true });
    } catch {
      return c.json({ authenticated: false }, 401);
    }
  })

  /**
   * Logout endpoint to clear authentication
   */
  .post("/logout", async (c) => {
    // Clear auth cookie
    deleteCookie(c, "sentry_auth_data", getSecureCookieOptions(c.req.url));

    // In a real implementation, you might want to revoke the token
    // For now, we'll just return success since the frontend handles token removal
    return c.json({ success: true });
  });
