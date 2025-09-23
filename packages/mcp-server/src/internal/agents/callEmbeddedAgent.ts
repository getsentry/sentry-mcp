import { generateText, Output } from "ai";
import { getOpenAIModel } from "./openai-provider";
import type { z } from "zod";

export type ToolCall = {
  toolName: string;
  args: any;
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
export async function callEmbeddedAgent<T>({
  system,
  prompt,
  tools,
  schema,
}: {
  system: string;
  prompt: string;
  tools: Record<string, any>;
  schema: z.ZodSchema<T>;
}): Promise<EmbeddedAgentResult<T>> {
  const capturedToolCalls: ToolCall[] = [];

  const result = await generateText({
    model: getOpenAIModel("gpt-4o"),
    system,
    prompt,
    tools,
    maxSteps: 5,
    experimental_output: Output.object({ schema }),
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

  return {
    result: result.experimental_output as T,
    toolCalls: capturedToolCalls,
  };
}
