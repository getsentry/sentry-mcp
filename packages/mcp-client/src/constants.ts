// Default MCP Server host
export const DEFAULT_MCP_HOST = "https://mcp.sentry.dev";

// Default AI model - using Claude Sonnet 4
export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// OAuth configuration
export const OAUTH_REDIRECT_PORT = 8765;
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/callback`;

// Default OAuth scopes
export const DEFAULT_OAUTH_SCOPES = [
  "org:read",
  "project:read",
  "project:write",
  "team:read",
  "team:write",
  "event:write",
];
