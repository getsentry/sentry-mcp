import { openai } from "@ai-sdk/openai";
import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import { generateText, stepCountIs } from "ai";
import type { Harness } from "vitest-evals";
import { withMockMcpClient } from "./mcpClient";
import type { ToolCallEvalMetadata } from "./types";

const defaultModel = openai("gpt-4o");

type AiSdkResultWithSteps = {
  steps?: unknown;
};

export function preferRuntimeToolCapture<TResult extends AiSdkResultWithSteps>(
  result: TResult,
): Omit<TResult, "steps"> & { steps?: undefined } {
  return {
    ...result,
    steps: undefined,
  };
}

export function createMcpToolCallHarness(
  maxSteps = 6,
): Harness<string, string, ToolCallEvalMetadata> {
  return {
    name: "mcp-tool-call",
    run: async (input, context) => {
      return await withMockMcpClient(async (client) => {
        const tools = await client.tools();
        const harness = aiSdkHarness({
          name: "mcp-tool-call",
          tools,
          run: async ({ input, context, runtime }) => {
            const result = await generateText({
              model: defaultModel,
              tools: runtime.tools,
              system: [
                "You are a Sentry assistant with access to Sentry MCP tools.",
                "Use search_tools before execute_tool when the needed Sentry operation is not directly listed as a tool.",
                "When search_tools returns a tool, call execute_tool with that returned tool name and arguments matching the returned schema.",
                "When the user says 'from Sentry in <organization>', Sentry is the product name and <organization> is the organizationSlug.",
              ].join("\n"),
              prompt: input,
              stopWhen: stepCountIs(maxSteps),
              abortSignal: context.signal,
              experimental_telemetry: {
                isEnabled: true,
                functionId: "catalog_tool_behavior_eval",
              },
            });

            return preferRuntimeToolCapture(result);
          },
        });

        return await harness.run(input, context);
      });
    },
  };
}

export const mcpToolCallHarness = createMcpToolCallHarness();
