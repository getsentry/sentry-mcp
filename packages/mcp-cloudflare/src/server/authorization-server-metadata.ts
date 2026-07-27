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
    // RFC 9207: we append `iss` on authorization responses (callback redirect).
    // Note: the emitted `iss` is the canonical origin-level issuer (matching
    // PRM authorization_servers + root AS metadata), not this path-scoped
    // compatibility issuer. Clients should discover via RFC 9728 PRM.
    authorization_response_iss_parameter_supported: true,
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

const ROOT_AUTHORIZATION_SERVER_METADATA_PATH =
  "/.well-known/oauth-authorization-server";

/**
 * workers-oauth-provider emits root AS metadata but does not advertise RFC 9207
 * support. When we append `iss` on authorization responses, patch the provider
 * document so clients can discover that behavior.
 */
export async function patchRootAuthorizationServerMetadata(
  response: Response,
  url: URL,
): Promise<Response> {
  if (
    !response.ok ||
    url.pathname !== ROOT_AUTHORIZATION_SERVER_METADATA_PATH
  ) {
    return response;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return response;
  }

  try {
    const metadata = (await response.clone().json()) as Record<string, unknown>;
    if (metadata.authorization_response_iss_parameter_supported === true) {
      return response;
    }

    const patched = {
      ...metadata,
      authorization_response_iss_parameter_supported: true,
    };

    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(patched), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    // Leave non-JSON or unreadable provider responses alone.
    return response;
  }
}
