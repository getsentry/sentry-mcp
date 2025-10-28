import { z } from "zod";
import { ConfigurationError } from "../../errors";
import { callEmbeddedAgent } from "../../internal/agents/callEmbeddedAgent";
import { systemPrompt } from "./config";

/**
 * Output schema for the embedded agent.
 * The agent returns the final result string directly from its tool calls.
 */
const outputSchema = z.object({
  result: z
    .string()
    .describe(
      "The final result from your tool calls that answers the user's request",
    ),
});

export interface UseSentryAgentOptions {
  request: string;
  tools: Record<string, any>; // agentTool-wrapped MCP tools
}

/**
 * use_sentry agent - executes natural language requests using Sentry MCP tools
 * This returns the final result AND the tool calls made by the agent
 */
export async function useSentryAgent(options: UseSentryAgentOptions): Promise<{
  result: z.infer<typeof outputSchema>;
  toolCalls: any[];
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ConfigurationError(
      "OPENAI_API_KEY environment variable is required for use_sentry tool",
    );
  }

  // Frame the request to make clear we're asking the agent to use tools
  // Don't just pass the raw request as it might trigger safety responses
  const prompt = options.request;

  // Use callEmbeddedAgent with all pre-wrapped MCP tools
  return await callEmbeddedAgent({
    system: systemPrompt,
    prompt: prompt,
    tools: options.tools,
    schema: outputSchema,
  });
}
