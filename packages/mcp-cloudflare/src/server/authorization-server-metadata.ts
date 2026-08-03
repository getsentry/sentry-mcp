import { SCOPES } from "../constants";

const OAUTH_METADATA_PREFIX = "/.well-known/oauth-authorization-server";

// RFC 8414 defines authorization server metadata at the root
// `/.well-known/oauth-authorization-server` endpoint. RFC 9728 defines
// path-specific protected resource metadata at
// `/.well-known/oauth-protected-resource/...`.
//
// Some MCP clients currently probe path-scoped RFC 8414 discovery URLs instead
// of RFC 9728 protected resource metadata. For those clients, we return a
// compatibility document whose authorization endpoint is pre-populated with
// the RFC 8707 `resource` parameter for the scoped `/mcp/...` URL.

function getResourcePath(requestUrl: URL): string {
  return requestUrl.pathname.replace(OAUTH_METADATA_PREFIX, "");
}

function getResourceUrl(requestUrl: URL, resourcePath: string): string {
  return `${requestUrl.origin}${resourcePath}${requestUrl.search}`;
}

function createAuthorizationEndpoint(
  resourceUrl: string,
  origin: string,
): string {
  const authorizationEndpoint = new URL("/oauth/authorize", origin);
  // RFC 8707: carry the protected resource identifier into the authorization
  // request so the consent page and downstream grant are bound to the same
  // `/mcp/...` resource the client is trying to access.
  authorizationEndpoint.searchParams.set("resource", resourceUrl);
  return authorizationEndpoint.href;
}

export function createScopedAuthorizationServerMetadataResponse(
  requestUrl: URL,
): Response {
  const resourcePath = getResourcePath(requestUrl);
  const resourceUrl = getResourceUrl(requestUrl, resourcePath);

  const metadata = {
    // RFC 8414 §3 requires the issuer in the metadata document to match the
    // issuer identifier used to derive the well-known URL. That identifier
    // can include a path, but RFC 8414 §2 forbids query components.
    issuer: `${requestUrl.origin}${resourcePath}`,
    authorization_endpoint: createAuthorizationEndpoint(
      resourceUrl,
      requestUrl.origin,
    ),
    token_endpoint: new URL("/oauth/token", requestUrl.origin).href,
    registration_endpoint: new URL("/oauth/register", requestUrl.origin).href,
    // Mirror the root AS metadata the provider emits when CIMD is enabled.
    // This compatibility shim is served by us, not workers-oauth-provider.
    client_id_metadata_document_supported: true,
    // Do not advertise RFC 9207 here: this compatibility document's issuer is
    // path-scoped, while authorization responses use the canonical origin-level
    // issuer advertised by RFC 9728 PRM and root AS metadata. RFC 9207 requires
    // the metadata issuer and response `iss` to be identical.
    scopes_supported: Object.keys(SCOPES),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    revocation_endpoint: new URL("/oauth/token", requestUrl.origin).href,
    code_challenge_methods_supported: ["plain", "S256"],
  };

  return new Response(JSON.stringify(metadata), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Hook for root authorization-server metadata adjustments.
 *
 * We still emit RFC 9207 `iss` on authorization redirects, but temporarily do
 * not advertise `authorization_response_iss_parameter_supported`.
 *
 * Codex CLI 0.146.0 / desktop 0.146.0-alpha.9.2 (rmcp 1.8.0) require callback
 * `iss` only when that metadata flag is true, then drop `iss` while parsing the
 * local OAuth callback. Advertising the flag therefore breaks login for those
 * clients. Fixed Codex builds (>= 0.146.0-alpha.15) parse and validate `iss`.
 *
 * TODO(2026-10-02): Revisit re-advertising RFC 9207 support once broken Codex
 * clients are no longer common enough to protect. Keep emitting callback `iss`
 * either way so correct clients can still validate it when present.
 */
export async function patchRootAuthorizationServerMetadata(
  response: Response,
  _url: URL,
): Promise<Response> {
  return response;
}
