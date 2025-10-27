/**
 * Request-scoped context storage using AsyncLocalStorage.
 *
 * This module provides per-request storage for the complete ServerContext,
 * including authentication and constraints extracted from URL patterns.
 * Used by the Cloudflare Worker MCP handler to make context available
 * to tool handlers without passing them through every function call.
 *
 * The context is stored in AsyncLocalStorage which is supported in:
 * - Node.js (native)
 * - Cloudflare Workers (via compatibility layer)
 * - Other modern JavaScript runtimes
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerContext } from "../types";

/**
 * AsyncLocalStorage instance for storing ServerContext per-request.
 *
 * Each MCP request runs within its own async context, ensuring
 * context is isolated between concurrent requests.
 */
export const serverContextStorage = new AsyncLocalStorage<ServerContext>();

/**
 * Get the current request's ServerContext from async storage.
 *
 * @returns ServerContext for the current request, or undefined if not in a request context
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker handler:
 * serverContextStorage.run(context, () => {
 *   // Inside this callback, getServerContext() returns the context
 *   const context = getServerContext();
 * });
 * ```
 */
export function getServerContext(): ServerContext | undefined {
  return serverContextStorage.getStore();
}

/**
 * Get the current request's ServerContext from async storage, throwing if not available.
 *
 * Use this when you need the context and it's an error condition if it's missing.
 *
 * @returns ServerContext for the current request
 * @throws Error if no context is available in async storage
 *
 * @example
 * ```typescript
 * // In a tool handler:
 * const context = requireServerContext();
 * // Use context knowing it's always defined
 * ```
 */
export function requireServerContext(): ServerContext {
  const context = serverContextStorage.getStore();
  if (!context) {
    throw new Error("No ServerContext available in async storage");
  }
  return context;
}
