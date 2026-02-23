// Public metadata endpoints that should be accessible from any origin
const PUBLIC_METADATA_PATHS = [
  "/.well-known/", // OAuth discovery endpoints
  "/robots.txt", // Search engine directives
  "/llms.txt", // LLM/AI agent directives
  "/mcp.json", // MCP server metadata
];

export const isPublicMetadataEndpoint = (pathname: string): boolean => {
  return PUBLIC_METADATA_PATHS.some((path) =>
    path.endsWith("/") ? pathname.startsWith(path) : pathname === path,
  );
};

export const addCorsHeaders = (response: Response): Response => {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Access-Control-Allow-Origin", "*");
  newResponse.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return newResponse;
};

// Strip permissive CORS headers added by the OAuth library in v0.0.12
// The library reflects the request Origin on all OAuth endpoints, which allows
// any website to make cross-origin token exchanges. We remove these and only
// add CORS explicitly on public metadata endpoints via addCorsHeaders above.
export const stripCorsHeaders = (response: Response): Response => {
  if (!response.headers.has("Access-Control-Allow-Origin")) {
    return response;
  }
  const newResponse = new Response(response.body, response);
  newResponse.headers.delete("Access-Control-Allow-Origin");
  newResponse.headers.delete("Access-Control-Allow-Methods");
  newResponse.headers.delete("Access-Control-Allow-Headers");
  newResponse.headers.delete("Access-Control-Max-Age");
  return newResponse;
};
