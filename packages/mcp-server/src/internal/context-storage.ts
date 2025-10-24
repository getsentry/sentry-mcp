/**
 * Request-scoped context storage using AsyncLocalStorage.
 *
 * This module provides per-request storage for constraints extracted from URL patterns.
 * Used by the Cloudflare Worker MCP handler to make org/project constraints available
 * to tool handlers without passing them through every function call.
 *
 * The constraints are stored in AsyncLocalStorage which is supported in:
 * - Node.js (native)
 * - Cloudflare Workers (via compatibility layer)
 * - Other modern JavaScript runtimes
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Constraints } from "../types";

/**
 * AsyncLocalStorage instance for storing constraints per-request.
 *
 * Each MCP request runs within its own async context, ensuring
 * constraints are isolated between concurrent requests.
 */
export const constraintsStorage = new AsyncLocalStorage<Constraints>();

/**
 * Get the current request's constraints from async storage.
 *
 * @returns Constraints for the current request, or empty object if not in a request context
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker handler:
 * constraintsStorage.run({ organizationSlug: "sentry" }, () => {
 *   // Inside this callback, getConstraints() returns { organizationSlug: "sentry" }
 *   const constraints = getConstraints();
 * });
 * ```
 */
export function getConstraints(): Constraints {
  return constraintsStorage.getStore() || {};
}
