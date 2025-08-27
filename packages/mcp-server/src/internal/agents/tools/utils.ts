import { UserInputError } from "../../../errors";
import { ApiClientError, ApiServerError } from "../../../api-client";
import { logError } from "../../../logging";

/**
 * Wraps an embedded agent tool's execute function with standardized error handling.
 *
 * For embedded agent tools (tools used by AI agents within other tools):
 * - UserInputError messages are thrown as formatted errors for AI to correct
 * - ApiClientError (4xx) messages are thrown as formatted errors for AI to correct
 * - ApiServerError (5xx) messages are logged to Sentry and thrown with Event ID
 * - All other errors are re-thrown to be handled by the parent tool
 *
 * This ensures that all errors are properly propagated to the AI SDK as tool errors,
 * allowing the AI agent to see the error and potentially correct its approach.
 * The AI SDK will convert these to tool-error content parts that the agent can process.
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
): (params: TParams) => Promise<TResult> {
  return async (params: TParams) => {
    try {
      return await fn(params);
    } catch (error) {
      // Handle both UserInputError and ApiClientError as user-facing errors
      if (error instanceof UserInputError) {
        // Log UserInputError for Sentry logging (as log, not exception)
        console.warn(`[agent-tool] ${error.message}`);
        // Throw formatted error that AI can see and potentially correct
        throw new Error(
          `Input Error: ${error.message}. You may be able to resolve this by addressing the concern and trying again.`,
        );
      }

      if (error instanceof ApiClientError) {
        // Log ApiClientError for Sentry logging (as log, not exception)
        const message = error.toUserMessage();
        console.warn(`[agent-tool] ${message}`);
        // Throw formatted error that AI can see and potentially correct
        throw new Error(
          `Input Error: ${message}. You may be able to resolve this by addressing the concern and trying again.`,
        );
      }

      if (error instanceof ApiServerError) {
        // Log server errors to Sentry and get Event ID
        const eventId = logError(error);
        // Throw formatted error with Event ID for AI awareness
        throw new Error(
          `Server Error (${error.status}): ${error.message}. Event ID: ${eventId}. This is a system error that cannot be resolved by retrying.`,
        );
      }

      // Re-throw all other errors to be handled by the parent tool's error handling
      throw error;
    }
  };
}
