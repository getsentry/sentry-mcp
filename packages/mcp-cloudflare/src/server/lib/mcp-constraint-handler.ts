import type { Env } from "../types";
import SentryMCP from "./mcp-transport";
import { parseMcpPath } from "./mcp-router";

/**
 * Creates an MCP handler that supports dynamic URL patterns for constraints.
 *
 * Since the OAuth provider uses `startsWith` for path matching, a handler
 * registered for "/mcp" will also match "/mcp/org/project". We can use this
 * to extract constraints from the URL path and pass them to the Durable Object
 * via custom headers.
 */
export function createConstraintAwareMcpHandler(basePath: "/mcp" | "/sse") {
  // Get the base handler from the original MCP transport
  const baseHandler =
    basePath === "/sse"
      ? SentryMCP.serveSSE(basePath)
      : SentryMCP.serve(basePath);

  return {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<Response> {
      const url = new URL(request.url);

      // Parse the URL to extract constraints
      const parsedPath = parseMcpPath(url.pathname);

      // If there are constraints in the URL, we need to handle them
      if (parsedPath?.constraints) {
        // Store constraints in a way they can be accessed by the Durable Object
        // Since we can't modify props directly, we'll use headers as a communication channel
        const headers = new Headers(request.headers);

        if (parsedPath.constraints.organizationSlug) {
          headers.set(
            "X-MCP-Constraint-Org",
            parsedPath.constraints.organizationSlug,
          );
        }
        if (parsedPath.constraints.projectSlug) {
          headers.set(
            "X-MCP-Constraint-Project",
            parsedPath.constraints.projectSlug,
          );
        }

        // Create a modified request with constraint headers
        const modifiedRequest = new Request(request.url, {
          method: request.method,
          headers,
          body: request.body,
          // Required for Node.js fetch when sending a body
          ...(request.body && { duplex: "half" as any }),
        });

        // Forward to the base handler
        return baseHandler.fetch(modifiedRequest, env, ctx);
      }

      // No constraints, just forward to the base handler
      return baseHandler.fetch(request, env, ctx);
    },
  };
}
