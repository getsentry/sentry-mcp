/**
 * OAuth Dynamic Client Registration Endpoint
 *
 * Implements RFC 7591 - OAuth 2.0 Dynamic Client Registration Protocol.
 * Allows MCP clients to register themselves without manual configuration.
 *
 * This endpoint:
 * 1. Validates client metadata
 * 2. Generates client credentials
 * 3. Stores the client registration
 * 4. Returns client information including secret (for confidential clients)
 *
 * @see RFC 7591 - OAuth 2.0 Dynamic Client Registration Protocol
 * @see RFC 7591 Section 2 - Client Metadata
 * @see RFC 7591 Section 3.1 - Client Registration Request
 * @see RFC 7591 Section 3.2 - Client Registration Response
 */

import { logIssue } from "@sentry/mcp-core/telem/logging";
import { type Context, Hono } from "hono";
import type { Env } from "../../types";
import { generateClientId, generateClientSecret, hashSecret } from "../crypto";
import type { OAuthStorage } from "../storage";
import type {
  ClientInfo,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
} from "../types";

// =============================================================================
// Configuration
// =============================================================================

/** Allowed token endpoint authentication methods */
const ALLOWED_AUTH_METHODS = [
  "none",
  "client_secret_basic",
  "client_secret_post",
] as const;

/** Default grant types for new clients */
const DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"];

/** Default response types for new clients */
const DEFAULT_RESPONSE_TYPES = ["code"];

// =============================================================================
// Route Handler
// =============================================================================

const registerRoute = new Hono<{ Bindings: Env }>();

/**
 * POST /oauth/register
 *
 * Register a new OAuth client dynamically.
 *
 * Request body (JSON):
 * - redirect_uris (required): Array of allowed redirect URIs
 * - client_name (optional): Human-readable client name
 * - client_uri (optional): URL of client's home page
 * - logo_uri (optional): URL of client's logo
 * - token_endpoint_auth_method (optional): Authentication method (default: "none")
 * - grant_types (optional): Allowed grant types (default: ["authorization_code", "refresh_token"])
 * - response_types (optional): Allowed response types (default: ["code"])
 *
 * @see RFC 7591 Section 3.1 - Client Registration Request
 */
registerRoute.post("/", async (c) => {
  // Get storage from context
  const storage = c.get("oauthStorage") as OAuthStorage;
  if (!storage) {
    logIssue("[oauth] OAuth storage not configured", {
      loggerScope: ["cloudflare", "oauth", "register"],
    });
    return c.json(
      {
        error: "server_error",
        error_description: "OAuth storage not configured",
      },
      500,
    );
  }

  // Parse JSON body
  let body: ClientRegistrationRequest;
  try {
    body = await c.req.json();
  } catch {
    return registrationError(c, "invalid_request", "Invalid JSON body");
  }

  // Validate required fields
  // RFC 7591 Section 2: redirect_uris is REQUIRED
  if (!body.redirect_uris || !Array.isArray(body.redirect_uris)) {
    return registrationError(
      c,
      "invalid_request",
      "Missing required field: redirect_uris",
    );
  }

  if (body.redirect_uris.length === 0) {
    return registrationError(
      c,
      "invalid_request",
      "redirect_uris must contain at least one URI",
    );
  }

  // Validate each redirect URI
  for (const uri of body.redirect_uris) {
    if (!isValidRedirectUri(uri)) {
      return registrationError(
        c,
        "invalid_redirect_uri",
        `Invalid redirect URI: ${uri}`,
      );
    }
  }

  // Validate token_endpoint_auth_method if provided
  const authMethod = body.token_endpoint_auth_method || "none";
  if (
    !ALLOWED_AUTH_METHODS.includes(
      authMethod as (typeof ALLOWED_AUTH_METHODS)[number],
    )
  ) {
    return registrationError(
      c,
      "invalid_client_metadata",
      `Invalid token_endpoint_auth_method: ${authMethod}. Allowed: ${ALLOWED_AUTH_METHODS.join(", ")}`,
    );
  }

  // Validate grant_types if provided
  const grantTypes = body.grant_types || DEFAULT_GRANT_TYPES;
  for (const grantType of grantTypes) {
    if (!["authorization_code", "refresh_token"].includes(grantType)) {
      return registrationError(
        c,
        "invalid_client_metadata",
        `Unsupported grant_type: ${grantType}`,
      );
    }
  }

  // Validate response_types if provided
  const responseTypes = body.response_types || DEFAULT_RESPONSE_TYPES;
  for (const responseType of responseTypes) {
    if (responseType !== "code") {
      return registrationError(
        c,
        "invalid_client_metadata",
        `Unsupported response_type: ${responseType}`,
      );
    }
  }

  // Validate URIs if provided
  if (body.client_uri && !isValidHttpsUrl(body.client_uri)) {
    return registrationError(
      c,
      "invalid_client_metadata",
      "client_uri must be a valid HTTPS URL",
    );
  }

  if (body.logo_uri && !isValidHttpsUrl(body.logo_uri)) {
    return registrationError(
      c,
      "invalid_client_metadata",
      "logo_uri must be a valid HTTPS URL",
    );
  }

  if (body.policy_uri && !isValidHttpsUrl(body.policy_uri)) {
    return registrationError(
      c,
      "invalid_client_metadata",
      "policy_uri must be a valid HTTPS URL",
    );
  }

  if (body.tos_uri && !isValidHttpsUrl(body.tos_uri)) {
    return registrationError(
      c,
      "invalid_client_metadata",
      "tos_uri must be a valid HTTPS URL",
    );
  }

  // Generate client credentials
  const clientId = generateClientId();
  const isConfidentialClient = authMethod !== "none";

  let clientSecret: string | undefined;
  let hashedClientSecret: string | undefined;

  if (isConfidentialClient) {
    clientSecret = generateClientSecret();
    hashedClientSecret = await hashSecret(clientSecret);
  }

  const now = Math.floor(Date.now() / 1000);

  // Create client record
  const client: ClientInfo = {
    clientId,
    clientSecret: hashedClientSecret,
    redirectUris: body.redirect_uris,
    clientName: body.client_name,
    clientUri: body.client_uri,
    logoUri: body.logo_uri,
    policyUri: body.policy_uri,
    tosUri: body.tos_uri,
    contacts: body.contacts,
    tokenEndpointAuthMethod:
      authMethod as ClientInfo["tokenEndpointAuthMethod"],
    grantTypes,
    responseTypes,
    registrationDate: now,
  };

  // Save client
  await storage.saveClient(client);

  // Build response
  // RFC 7591 Section 3.2.1: Return client information
  const response: ClientRegistrationResponse = {
    client_id: clientId,
    client_id_issued_at: now,
    redirect_uris: body.redirect_uris,
    client_name: body.client_name,
    client_uri: body.client_uri,
    logo_uri: body.logo_uri,
    token_endpoint_auth_method: authMethod,
    grant_types: grantTypes,
    response_types: responseTypes,
  };

  // Include client_secret for confidential clients (only returned once!)
  if (isConfidentialClient && clientSecret) {
    response.client_secret = clientSecret;
    response.client_secret_expires_at = 0; // 0 means never expires
  }

  // RFC 7591 Section 3.2.1: Return 201 Created
  return c.json(response, 201, {
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
});

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate a redirect URI.
 *
 * Redirect URIs must:
 * - Be absolute URIs
 * - Use https:// scheme (except localhost for development)
 * - Not contain fragments
 *
 * @see RFC 6749 Section 3.1.2 - Redirection Endpoint
 * @see RFC 6749 Section 3.1.2.1 - Endpoint Request Confidentiality
 */
function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);

    // Must be http or https
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    // HTTP only allowed for localhost (development)
    if (url.protocol === "http:") {
      const isLocalhost =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]";
      if (!isLocalhost) {
        return false;
      }
    }

    // No fragments allowed (RFC 6749 Section 3.1.2)
    if (url.hash) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an HTTPS URL.
 *
 * Used for client_uri, logo_uri, policy_uri, tos_uri.
 */
function isValidHttpsUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

// =============================================================================
// Error Responses
// =============================================================================

/**
 * Registration error codes per RFC 7591 Section 3.2.2.
 */
type RegistrationErrorCode =
  | "invalid_request"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "server_error";

/**
 * Create a registration error response.
 *
 * @see RFC 7591 Section 3.2.2 - Client Registration Error Response
 */
function registrationError(
  c: Context<{ Bindings: Env }>,
  error: RegistrationErrorCode,
  description: string,
): Response {
  const status = error === "server_error" ? 500 : 400;
  if (status === 500) {
    logIssue(`[oauth] Registration error: ${description}`, {
      loggerScope: ["cloudflare", "oauth", "register"],
    });
  }
  return c.json({ error, error_description: description }, status);
}

export default registerRoute;
