/**
 * OAuth Authorization Server Metadata Endpoint
 *
 * Implements RFC 8414 - OAuth 2.0 Authorization Server Metadata.
 * Provides discovery information for OAuth clients.
 *
 * Clients can discover server capabilities without prior configuration by
 * fetching /.well-known/oauth-authorization-server
 *
 * @see RFC 8414 - OAuth 2.0 Authorization Server Metadata
 * @see RFC 8414 Section 2 - Authorization Server Metadata
 * @see RFC 8414 Section 3 - Obtaining Authorization Server Metadata
 */

import { Hono } from "hono";
import { SCOPES } from "../../../constants";
import type { Env } from "../../types";
import type { AuthorizationServerMetadata } from "../types";

// =============================================================================
// Route Handler
// =============================================================================

const metadataRoute = new Hono<{ Bindings: Env }>();

/**
 * GET /.well-known/oauth-authorization-server
 *
 * Returns OAuth 2.0 Authorization Server Metadata.
 *
 * @see RFC 8414 Section 3 - Obtaining Authorization Server Metadata
 */
metadataRoute.get("/", (c) => {
  // Determine issuer URL from request
  const url = new URL(c.req.url);
  const issuer = `${url.protocol}//${url.host}`;

  // Build metadata response
  // RFC 8414 Section 2: Authorization Server Metadata
  const metadata: AuthorizationServerMetadata = {
    /**
     * RFC 8414 Section 2: issuer (REQUIRED)
     * The authorization server's issuer identifier URL.
     * Must be identical to the URL the client used to retrieve the metadata.
     */
    issuer,

    /**
     * RFC 8414 Section 2: authorization_endpoint (REQUIRED)
     * URL of the authorization endpoint.
     * @see RFC 6749 Section 3.1 - Authorization Endpoint
     */
    authorization_endpoint: `${issuer}/oauth/authorize`,

    /**
     * RFC 8414 Section 2: token_endpoint (REQUIRED unless only implicit grant)
     * URL of the token endpoint.
     * @see RFC 6749 Section 3.2 - Token Endpoint
     */
    token_endpoint: `${issuer}/oauth/token`,

    /**
     * RFC 8414 Section 2: registration_endpoint (OPTIONAL)
     * URL of the dynamic client registration endpoint.
     * @see RFC 7591 - Dynamic Client Registration
     */
    registration_endpoint: `${issuer}/oauth/register`,

    /**
     * RFC 8414 Section 2: scopes_supported (RECOMMENDED)
     * List of supported scope values.
     */
    scopes_supported: Object.keys(SCOPES),

    /**
     * RFC 8414 Section 2: response_types_supported (REQUIRED)
     * List of supported response_type values.
     * @see RFC 6749 Section 3.1.1 - Response Type
     */
    response_types_supported: ["code"],

    /**
     * RFC 8414 Section 2: grant_types_supported (OPTIONAL)
     * List of supported grant types.
     * @see RFC 6749 Section 4 - Obtaining Authorization
     */
    grant_types_supported: ["authorization_code", "refresh_token"],

    /**
     * RFC 8414 Section 2: token_endpoint_auth_methods_supported (OPTIONAL)
     * List of supported client authentication methods at token endpoint.
     * @see RFC 6749 Section 2.3 - Client Authentication
     */
    token_endpoint_auth_methods_supported: [
      "none", // Public clients (RFC 6749 Section 2.1)
      "client_secret_basic", // HTTP Basic auth (RFC 6749 Section 2.3.1)
      "client_secret_post", // Credentials in body (RFC 6749 Section 2.3.1)
    ],

    /**
     * RFC 8414 Section 2: code_challenge_methods_supported (OPTIONAL)
     * List of supported PKCE code challenge methods.
     * @see RFC 7636 - PKCE
     */
    code_challenge_methods_supported: ["plain", "S256"],

    /**
     * RFC 8414 Section 2: revocation_endpoint (OPTIONAL)
     * URL of the token revocation endpoint.
     * @see RFC 7009 - Token Revocation
     */
    revocation_endpoint: `${issuer}/oauth/revoke`,

    /**
     * RFC 8414 Section 2: revocation_endpoint_auth_methods_supported (OPTIONAL)
     * List of supported client authentication methods at revocation endpoint.
     */
    revocation_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
  };

  /**
   * RFC 8414 Section 3: Response
   * The response is a JSON object with Content-Type: application/json.
   * Cache-Control headers are recommended for efficiency.
   */
  return c.json(metadata, 200, {
    "Content-Type": "application/json",
    // Cache for 1 hour - metadata doesn't change frequently
    "Cache-Control": "public, max-age=3600",
  });
});

export default metadataRoute;
