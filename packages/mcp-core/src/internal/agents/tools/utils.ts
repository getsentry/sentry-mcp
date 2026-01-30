import { tool } from "ai";
import { z } from "zod";
import { UserInputError, LLMProviderError } from "../../../errors";
import { ApiClientError, ApiServerError } from "../../../api-client";
import { logIssue, logWarn } from "../../../telem/logging";

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
 * Handles errors from agent tool execution and returns appropriate error messages.
 *
 * SECURITY: Only returns trusted error messages to prevent prompt injection.
 * We trust: Sentry API errors, our own UserInputError messages, and system templates.
 */
function handleAgentToolError<T>(error: unknown): AgentToolResponse<T> {
  if (error instanceof UserInputError) {
    // Log UserInputError for Sentry logging (as log, not exception)
    logWarn(error, {
      loggerScope: ["agent-tools", "user-input"],
      contexts: {
        agentTool: {
          errorType: "UserInputError",
        },
      },
    });
    return {
      error: `Input Error: ${error.message}. You may be able to resolve this by addressing the concern and trying again.`,
    };
  }

  if (error instanceof LLMProviderError) {
    // Log LLMProviderError for Sentry logging (as log, not exception)
    logWarn(error, {
      loggerScope: ["agent-tools", "llm-provider"],
      contexts: {
        agentTool: {
          errorType: "LLMProviderError",
        },
      },
    });
    return {
      error: `AI Provider Error: ${error.message}. This is a service availability issue that cannot be resolved by retrying.`,
    };
  }

  if (error instanceof ApiClientError) {
    // Log ApiClientError for Sentry logging (as log, not exception)
    const message = error.toUserMessage();
    logWarn(message, {
      loggerScope: ["agent-tools", "api-client"],
      contexts: {
        agentTool: {
          errorType: error.name,
          status: error.status ?? null,
        },
      },
    });
    return {
      error: `Input Error: ${message}. You may be able to resolve this by addressing the concern and trying again.`,
    };
  }

  if (error instanceof ApiServerError) {
    // Log server errors to Sentry and get Event ID
    const eventId = logIssue(error);
    const statusText = error.status ? ` (${error.status})` : "";
    return {
      error: `Server Error${statusText}: ${error.message}. Event ID: ${eventId}. This is a system error that cannot be resolved by retrying.`,
    };
  }

  // Log unexpected errors to Sentry and return safe generic message
  // SECURITY: Don't return untrusted error messages that could enable prompt injection
  const eventId = logIssue(error);
  return {
    error: `System Error: An unexpected error occurred. Event ID: ${eventId}. This is a system error that cannot be resolved by retrying.`,
  };
}

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
        return handleAgentToolError<InferredResult>(error);
      }
    },
  });
}
