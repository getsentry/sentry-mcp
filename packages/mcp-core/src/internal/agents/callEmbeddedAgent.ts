import { generateText, Output, type Tool, APICallError, stepCountIs } from "ai";
import { getAgentProvider } from "./provider-factory";
import { UserInputError, LLMProviderError } from "../../errors";
import type { z } from "zod";

export type ToolCall = {
  toolName: string;
  args: unknown;
};

interface EmbeddedAgentResult<T> {
  result: T;
  toolCalls: ToolCall[];
}

/**
 * Call an embedded agent with tool call capture
 * This is the standard way to call embedded AI agents within MCP tools
 *
 * Error handling:
 * - Errors are re-thrown for the calling agent to handle
 * - Each agent can implement its own error handling strategy
 */
export async function callEmbeddedAgent<
  TOutput,
  TSchema extends z.ZodType<TOutput, z.ZodTypeDef, unknown>,
>({
  system,
  prompt,
  tools,
  schema,
}: {
  system: string;
  prompt: string;
  tools: Record<string, Tool>;
  schema: TSchema;
}): Promise<EmbeddedAgentResult<TOutput>> {
  const capturedToolCalls: ToolCall[] = [];

  // Get the configured provider (OpenAI or Anthropic)
  const provider = getAgentProvider();

  const result = await generateText({
    model: provider.getModel(),
    system,
    prompt,
    tools,
    stopWhen: stepCountIs(5),
    // Only include temperature if provider specifies one (e.g., GPT-5 requires temperature=1)
    ...(provider.getTemperature() !== undefined && {
      temperature: provider.getTemperature(),
    }),
    experimental_output: Output.object({ schema }),
    experimental_telemetry: {
      isEnabled: true,
      functionId: "callEmbeddedAgent",
    },
    // Provider-specific options (e.g., OpenAI needs structuredOutputs: false)
    // See: https://github.com/getsentry/sentry-mcp/issues/623
    providerOptions: provider.getProviderOptions(),
    onStepFinish: (event) => {
      if (event.toolCalls && event.toolCalls.length > 0) {
        for (const toolCall of event.toolCalls) {
          capturedToolCalls.push({
            toolName: toolCall.toolName,
            args: toolCall.input,
          });
        }
      }
    },
  }).catch((error: unknown) => {
    // Handle LLM provider errors with user-friendly messages
    // These are user-facing errors that should NOT be reported to Sentry
    if (APICallError.isInstance(error)) {
      // OpenAI region restriction error - provide specific helpful message
      if (
        error.message.includes("Country, region, or territory not supported")
      ) {
        throw new LLMProviderError(
          "The AI provider (OpenAI) does not support requests from your region. " +
            "This is a restriction imposed by OpenAI on certain countries and territories. " +
            "Please contact support if you believe this is an error.",
        );
      }

      // All 4xx errors are user-facing (account issues, rate limits, invalid keys, etc.)
      // These should be shown to the user, not reported to Sentry
      const statusCode = error.statusCode;
      if (statusCode && statusCode >= 400 && statusCode < 500) {
        throw new LLMProviderError(
          `The AI provider returned an error: ${error.message}. This may be a configuration or account issue. Please check your AI provider settings.`,
        );
      }
    }
    // Re-throw 5xx and other errors to be handled by the caller (logged to Sentry)
    throw error;
  });

  if (!result.experimental_output) {
    throw new Error("Failed to generate output");
  }

  const rawOutput = result.experimental_output;

  if (
    typeof rawOutput === "object" &&
    rawOutput !== null &&
    "error" in rawOutput &&
    typeof (rawOutput as { error?: unknown }).error === "string"
  ) {
    throw new UserInputError((rawOutput as { error: string }).error);
  }

  const parsedResult = schema.safeParse(rawOutput);

  if (!parsedResult.success) {
    throw new UserInputError(
      `Invalid agent response: ${parsedResult.error.message}`,
    );
  }

  return {
    result: parsedResult.data,
    toolCalls: capturedToolCalls,
  };
}
