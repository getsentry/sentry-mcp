import { SCOPES } from "../constants";

const PROTECTED_RESOURCE_METADATA_PREFIX =
  "/.well-known/oauth-protected-resource";

export function getProtectedResourceMetadata(requestUrl: URL) {
  // RFC 9728 path-specific metadata should round-trip the exact protected
  // resource path and query. The root metadata endpoint is less precise:
  // `https://host` and `https://host/` both arrive here as `/`, so we
  // normalize that case to the bare origin and rely on `/.well-known/
  // oauth-protected-resource/mcp...` for exact MCP resource identifiers.
  const resourcePath = requestUrl.pathname.replace(
    PROTECTED_RESOURCE_METADATA_PREFIX,
    "",
  );
  const resourceSuffix = `${resourcePath}${requestUrl.search}`;

  return {
    resource: `${requestUrl.origin}${resourceSuffix}`,
    authorization_servers: [requestUrl.origin],
    scopes_supported: Object.keys(SCOPES),
    bearer_methods_supported: ["header"],
  };
}

export function createProtectedResourceMetadataResponse(
  requestUrl: URL,
): Response {
  return new Response(
    JSON.stringify(getProtectedResourceMetadata(requestUrl)),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
