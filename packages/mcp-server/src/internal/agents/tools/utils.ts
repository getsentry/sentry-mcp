import { tool } from "ai";
import { z } from "zod";
import { UserInputError } from "../../../errors";
import { ApiClientError, ApiServerError } from "../../../api-client";
import { logError } from "../../../logging";

/**
 * Standard response schema for all embedded agent tools.
 * Tools return either an error message or the result data, never both.
 */
const AgentToolResponseSchema = z.object({
  error: z
    .string()
    .optional()
    .describe("Error message if the operation failed"),
  result: z.unknown().optional().describe("The successful result data"),
});

export type AgentToolResponse<T = unknown> = {
  error?: string;
  result?: T;
};

/**
 * Creates an embedded agent tool with automatic error handling and schema wrapping.
 *
 * This wrapper:
 * - Maintains the same API as the AI SDK's tool() function
 * - Automatically wraps the result schema with error/result structure
 * - Handles all error types and returns them as structured responses
 * - Preserves type inference from the original tool implementation
 *
 * @example
 * ```typescript
 * export function createMyTool(apiService: SentryApiService) {
 *   return agentTool({
 *     description: "My tool description",
 *     parameters: z.object({ param: z.string() }),
 *     execute: async (params) => {
 *       // Tool implementation that might throw errors
 *       const result = await apiService.someMethod(params);
 *       return result; // Original return type preserved
 *     }
 *   });
 * }
 * ```
 */
export function agentTool<TParameters, TResult>(config: {
  description: string;
  parameters: z.ZodSchema<TParameters>;
  execute: (params: TParameters) => Promise<TResult>;
}) {
  // Infer the result type from the execute function's return type
  type InferredResult = Awaited<ReturnType<typeof config.execute>>;

  return tool({
    description: config.description,
    parameters: config.parameters,
    execute: async (
      params: TParameters,
    ): Promise<AgentToolResponse<InferredResult>> => {
      try {
        const result = await config.execute(params);
        return { result };
      } catch (error) {
        // Handle both UserInputError and ApiClientError as user-facing errors
        if (error instanceof UserInputError) {
          // Log UserInputError for Sentry logging (as log, not exception)
          console.warn(`[agent-tool] ${error.message}`);
          return {
            error: `Input Error: ${error.message}. You may be able to resolve this by addressing the concern and trying again.`,
          };
        }

        if (error instanceof ApiClientError) {
          // Log ApiClientError for Sentry logging (as log, not exception)
          const message = error.toUserMessage();
          console.warn(`[agent-tool] ${message}`);
          return {
            error: `Input Error: ${message}. You may be able to resolve this by addressing the concern and trying again.`,
          };
        }

        if (error instanceof ApiServerError) {
          // Log server errors to Sentry and get Event ID
          const eventId = logError(error);
          return {
            error: `Server Error (${error.status}): ${error.message}. Event ID: ${eventId}. This is a system error that cannot be resolved by retrying.`,
          };
        }

        // Re-throw all other errors to be handled by the parent tool's error handling
        throw error;
      }
    },
  });
}
