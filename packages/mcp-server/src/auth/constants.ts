/**
 * OAuth configuration constants for stdio MCP server
 */

/**
 * Port for OAuth callback server
 * Uses 6363 to avoid conflicts with test client (8765) and common dev ports
 */
export const OAUTH_REDIRECT_PORT = 6363;

/**
 * OAuth redirect URI for authorization callback
 * Uses 127.0.0.1 (not localhost) for maximum compatibility
 */
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_REDIRECT_PORT}/callback`;

/**
 * Directory for storing OAuth configuration and tokens
 * Separate from test client to avoid conflicts
 */
export const CONFIG_DIR_NAME = ".config/sentry-mcp-server";
