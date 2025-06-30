/**
 * MCP Metadata API endpoint
 *
 * Provides immediate access to MCP server metadata including prompts and tools
 * without requiring a chat stream to be initialized.
 */
import { Hono } from "hono";
import { experimental_createMCPClient } from "ai";
import type { Env } from "../types";
import { logError } from "@sentry/mcp-server/logging";
import { getMcpPrompts, serializePromptsForClient } from "../lib/mcp-prompts";
import type { ErrorResponse } from "../types/chat";
import { analyzeAuthError, getAuthErrorResponse } from "../utils/auth-errors";

function createErrorResponse(errorResponse: ErrorResponse): ErrorResponse {
  return errorResponse;
}

export default new Hono<{ Bindings: Env }>().get("/", async (c) => {
  // Get the authorization header for MCP authentication
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      createErrorResponse({
        error: "Authorization required",
        name: "MISSING_AUTH_TOKEN",
      }),
      401,
    );
  }

  const accessToken = authHeader.substring(7); // Remove "Bearer " prefix

  try {
    // Get prompts directly from MCP server definitions
    const prompts = getMcpPrompts();
    const serializedPrompts = serializePromptsForClient(prompts);

    // Get tools by connecting to MCP server
    let tools: string[] = [];
    try {
      const requestUrl = new URL(c.req.url);
      const sseUrl = `${requestUrl.protocol}//${requestUrl.host}/sse`;

      const mcpClient = await experimental_createMCPClient({
        name: "sentry",
        transport: {
          type: "sse" as const,
          url: sseUrl,
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });

      const mcpTools = await mcpClient.tools();
      tools = Object.keys(mcpTools);
    } catch (error) {
      // If we can't get tools, continue with just prompts
      console.warn("Failed to fetch tools from MCP server:", error);
    }

    // Return the metadata
    return c.json({
      type: "mcp-metadata",
      prompts: serializedPrompts,
      tools,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Metadata API error:", error);

    // Check if this is an authentication error
    const authInfo = analyzeAuthError(error);
    if (authInfo.isAuthError) {
      return c.json(
        createErrorResponse(getAuthErrorResponse(authInfo)),
        authInfo.statusCode || (401 as any),
      );
    }

    const eventId = logError(error);
    return c.json(
      createErrorResponse({
        error: "Failed to fetch MCP metadata",
        name: "METADATA_FETCH_FAILED",
        eventId,
      }),
      500,
    );
  }
});
