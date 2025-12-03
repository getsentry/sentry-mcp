import { generateText, Output, type Tool } from "ai";
import { getOpenAIModel } from "./openai-provider";
import { UserInputError } from "../../errors";
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

  const result = await generateText({
    model: getOpenAIModel(), // Uses configured default model (gpt-5)
    system,
    prompt,
    tools,
    maxSteps: 5,
    temperature: 1, // GPT-5 only supports temperature of 1
    experimental_output: Output.object({ schema }),
    experimental_telemetry: {
      isEnabled: true,
      functionId: "callEmbeddedAgent",
    },
    // Disable strict schema validation for both output and tool parameter schemas.
    //
    // OpenAI's structured outputs have limitations:
    // - structuredOutputs: true (default) enforces strict mode for BOTH output and tool schemas
    // - This requires ALL properties to be in the "required" array, breaking .optional()/.nullable()
    //
    // By setting both to false:
    // - structuredOutputs: false - Disables strict mode for tool parameter schemas
    // - strictJsonSchema: false - Disables strict mode for output schema
    // - We still get valid JSON, just without the strict "all fields required" constraint
    //
    // See:
    // - Issue: https://github.com/getsentry/sentry-mcp/issues/623
    // - AI SDK docs: https://ai-sdk.dev/providers/ai-sdk-providers/openai#structuredoutputs
    // - OpenAI docs: https://platform.openai.com/docs/guides/structured-outputs
    providerOptions: {
      openai: {
        structuredOutputs: false,
        strictJsonSchema: false,
      },
    },
    onStepFinish: (event) => {
      if (event.toolCalls && event.toolCalls.length > 0) {
        for (const toolCall of event.toolCalls) {
          capturedToolCalls.push({
            toolName: toolCall.toolName,
            args: toolCall.args,
          });
        }
      }
    },
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
