/**
 * AsyncLocalStorage-based context management for ServerContext.
 *
 * This module provides a hybrid approach to context management:
 * - Tool handlers still receive context explicitly (keeps tests simple)
 * - Transport layers wrap requests with runWithContext()
 * - Server registration reads context from AsyncLocalStorage
 *
 * This eliminates the need to dynamically create server instances per context
 * while maintaining explicit context parameters in tool handlers for testability.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerContext } from "./types";

const contextStorage = new AsyncLocalStorage<ServerContext>();

/**
 * Get the current ServerContext from AsyncLocalStorage or Cloudflare global.
 *
 * This should only be called from within the MCP server infrastructure
 * (e.g., server.ts during tool registration). Tool handlers should receive
 * context as an explicit parameter.
 *
 * For Cloudflare Workers, AsyncLocalStorage doesn't propagate through the
 * agents library's event handling, so we fall back to checking a global
 * reference to the current Durable Object.
 *
 * @throws {Error} If context is not set (not within runWithContext or Cloudflare DO)
 * @returns The current ServerContext
 *
 * @example
 * ```typescript
 * // In server.ts tool registration
 * server.tool("tool_name", schema, async (params) => {
 *   const context = getServerContext(); // Get from AsyncLocalStorage or Cloudflare global
 *   return tool.handler(params, context); // Pass explicitly to handler
 * });
 * ```
 */
export function getServerContext(): ServerContext {
  // First try AsyncLocalStorage (works for stdio transport)
  const context = contextStorage.getStore();
  if (context) {
    return context;
  }

  // Fallback for Cloudflare: check if there's a current SentryMCPAgent in the global
  const agent = (globalThis as any).__currentSentryMCPAgent;
  if (agent?.serverContext) {
    return agent.serverContext;
  }

  throw new Error(
    "ServerContext not available. This should only be called from within " +
      "a tool/prompt/resource handler during an active MCP request. " +
      "Ensure the transport layer wraps requests with runWithContext().",
  );
}

/**
 * Run a function with ServerContext available in AsyncLocalStorage.
 *
 * Used by transport layers (stdio, SSE/WebSocket) to establish context
 * for the duration of a request or connection lifecycle.
 *
 * @param context - The ServerContext to make available
 * @param fn - The function to execute with context
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * // In stdio transport
 * export async function startStdio(server: McpServer, context: ServerContext) {
 *   await configureServer({ server }); // Static configuration
 *   await runWithContext(context, async () => {
 *     const transport = new StdioServerTransport();
 *     await server.connect(transport);
 *   });
 * }
 * ```
 */
export function runWithContext<T>(context: ServerContext, fn: () => T): T {
  return contextStorage.run(context, fn);
}

/**
 * Optionally get ServerContext if available, return undefined if not.
 *
 * This is useful for defensive code that might run outside request context,
 * or for helper functions that can use context if available but don't require it.
 *
 * @returns The current ServerContext or undefined if not set
 *
 * @example
 * ```typescript
 * // In a helper function
 * export function someHelper(explicitContext?: ServerContext) {
 *   const context = explicitContext ?? tryGetServerContext();
 *   if (context) {
 *     // Use context if available
 *   }
 * }
 * ```
 */
export function tryGetServerContext(): ServerContext | undefined {
  return contextStorage.getStore();
}
