/**
 * CORS utilities for the Cloudflare worker entry point.
 *
 * Why this exists:
 * @cloudflare/workers-oauth-provider v0.0.12 adds reflected-origin CORS headers
 * to every response it handles (token, register, MCP API, well-known). Its
 * `addCorsHeaders` reflects the request's `Origin` header verbatim and allows
 * all methods/headers — effectively disabling the same-origin policy for those
 * endpoints. We can't configure or disable this behavior in the library.
 *
 * Our strategy (implemented in the wrappedOAuthProvider in index.ts):
 * 1. Intercept OPTIONS before the library runs — return our own preflight.
 * 2. Let the library handle the actual request (it will add its CORS headers).
 * 3. On the way out, either:
 *    - Replace with restrictive CORS for public metadata endpoints, or
 *    - Strip the library's CORS headers entirely for everything else.
 */

/** Paths that should be accessible from any origin (read-only metadata). */
const PUBLIC_METADATA_PATHS = [
  "/.well-known/", // OAuth/resource discovery (RFC 8414, RFC 9728)
  "/.mcp/", // MCP tool definitions for documentation sites
  "/robots.txt", // Search engine directives
  "/llms.txt", // LLM/AI agent directives
  "/mcp.json", // MCP server metadata
];

/**
 * Check whether a pathname serves public, read-only metadata that should
 * be available cross-origin. Prefix entries (ending with "/") use startsWith;
 * exact entries require an exact match.
 */
export const isPublicMetadataEndpoint = (pathname: string): boolean => {
  return PUBLIC_METADATA_PATHS.some((path) =>
    path.endsWith("/") ? pathname.startsWith(path) : pathname === path,
  );
};

/**
 * Apply restrictive CORS headers suitable for public metadata endpoints.
 * Only allows GET and OPTIONS with Content-Type — no credentials, no mutation.
 * Uses `*` origin since these endpoints serve non-sensitive, publicly-available data.
 *
 * Also removes any leftover CORS headers the OAuth library may have added
 * (e.g. Max-Age, Expose-Headers, Allow-Credentials) to prevent contradictory
 * or overly permissive combinations.
 */
export const addCorsHeaders = (response: Response): Response => {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Access-Control-Allow-Origin", "*");
  newResponse.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type");
  // Remove headers the OAuth library may have set that we don't want
  newResponse.headers.delete("Access-Control-Max-Age");
  newResponse.headers.delete("Access-Control-Expose-Headers");
  newResponse.headers.delete("Access-Control-Allow-Credentials");
  return newResponse;
};

/**
 * Remove all CORS headers from a response.
 *
 * This undoes the reflected-origin CORS that @cloudflare/workers-oauth-provider
 * adds automatically. Without stripping, endpoints like /oauth/token and
 * /oauth/register would be callable cross-origin from any website — an attacker
 * could phish a user into visiting a malicious page that silently exchanges
 * tokens against our server.
 *
 * Returns the original response unchanged if no CORS headers are present
 * (e.g. when the request had no Origin header so the library skipped CORS).
 */
export const stripCorsHeaders = (response: Response): Response => {
  if (!response.headers.has("Access-Control-Allow-Origin")) {
    return response;
  }
  const newResponse = new Response(response.body, response);
  newResponse.headers.delete("Access-Control-Allow-Origin");
  newResponse.headers.delete("Access-Control-Allow-Methods");
  newResponse.headers.delete("Access-Control-Allow-Headers");
  newResponse.headers.delete("Access-Control-Max-Age");
  newResponse.headers.delete("Access-Control-Expose-Headers");
  return newResponse;
};
