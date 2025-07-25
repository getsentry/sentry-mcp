import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import type { CoreToolCall } from "ai";
import type { z } from "zod";

interface EmbeddedAgentResult<T> {
  result: T;
  toolCalls: CoreToolCall<any, any>[];
}

/**
 * Call an embedded agent with tool call capture
 * This is the standard way to call embedded AI agents within MCP tools
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
  const capturedToolCalls: CoreToolCall<any, any>[] = [];

  const result = await generateText({
    model: openai("gpt-4o"),
    system,
    prompt,
    tools,
    maxSteps: 5,
    experimental_output: Output.object({ schema }),
    onStepFinish: (event) => {
      if (event.toolCalls && event.toolCalls.length > 0) {
        for (const toolCall of event.toolCalls) {
          capturedToolCalls.push(toolCall);
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
