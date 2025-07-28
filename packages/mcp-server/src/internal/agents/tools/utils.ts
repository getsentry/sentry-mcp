import { UserInputError } from "../../../errors";

/**
 * Wraps an embedded agent tool's execute function with standardized error handling.
 *
 * For embedded agent tools (tools used by AI agents within other tools):
 * - UserInputError messages are returned as formatted error strings
 * - All other errors are re-thrown to be handled by the parent tool
 *
 * This ensures that validation errors are surfaced to the AI agent as text
 * it can work with, while system errors bubble up to the tool handler.
 *
 * @example
 * ```typescript
 * export function createMyTool(apiService: SentryApiService) {
 *   return tool({
 *     description: "My tool description",
 *     parameters: z.object({ ... }),
 *     execute: wrapAgentToolExecute(async (params) => {
 *       // Tool implementation that might throw errors
 *       return await apiService.someMethod(params);
 *     })
 *   });
 * }
 * ```
 */
export function wrapAgentToolExecute<TParams, TResult>(
  fn: (params: TParams) => Promise<TResult>,
): (params: TParams) => Promise<TResult | string> {
  return async (params: TParams) => {
    try {
      return await fn(params);
    } catch (error) {
      if (error instanceof UserInputError) {
        // Return user input errors as formatted strings for the AI to process
        return `Error: ${error.message}`;
      }
      // Re-throw all other errors to be handled by the parent tool's error handling
      throw error;
    }
  };
}
