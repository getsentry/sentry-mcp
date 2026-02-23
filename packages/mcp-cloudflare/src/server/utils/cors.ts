// Public metadata endpoints that should be accessible from any origin
const PUBLIC_METADATA_PATHS = [
  "/.well-known/",
  "/robots.txt",
  "/llms.txt",
  "/mcp.json",
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

// Strip reflected-origin CORS headers the OAuth library
// adds adds to all endpoints in v0.0.12
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
