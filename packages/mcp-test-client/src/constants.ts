// Default MCP Server
export const DEFAULT_MCP_URL = "https://mcp.sentry.dev";

export const DEFAULT_OPENAI_MODEL = "gpt-4o";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// OAuth configuration. Overridable via MCP_OAUTH_PORT, MCP_OAUTH_HOST, and
// MCP_OAUTH_REDIRECT_URI - see auth/redirect.ts.
export const DEFAULT_OAUTH_REDIRECT_PORT = 8765;
export const DEFAULT_OAUTH_CALLBACK_HOST = "127.0.0.1";

// Default OAuth scopes
export const DEFAULT_OAUTH_SCOPES = [
  "org:read",
  "project:read",
  "project:write",
  "team:read",
  "team:write",
  "event:write",
];
