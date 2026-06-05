import { openai } from "@ai-sdk/openai";
import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import { generateText, stepCountIs } from "ai";
import { withMockMcpClient } from "./mcpClient";
import type { ToolCallEvalMetadata } from "./types";

const defaultModel = openai("gpt-4o");

function getTextOutput(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "text" in result &&
    typeof result.text === "string"
  ) {
    return result.text;
  }

  throw new Error("MCP tool-call harness did not produce text output");
}

export function createMcpToolCallHarness(maxSteps = 6) {
  return aiSdkHarness<
    undefined,
    string,
    ToolCallEvalMetadata,
    unknown,
    Record<string, never>,
    string
  >({
    name: "mcp-tool-call",
    run: async ({ input, context }) => {
      return await withMockMcpClient(async (client) => {
        const tools = await client.tools();

        return await generateText({
          model: defaultModel,
          tools,
          system: [
            "You are a Sentry assistant with access to Sentry MCP tools.",
            "Use search_tools before execute_tool when the needed Sentry operation is not directly listed as a tool.",
            "When search_tools returns a tool, call execute_tool with that returned tool name and arguments matching the returned schema.",
          ].join("\n"),
          prompt: input,
          stopWhen: stepCountIs(maxSteps),
          abortSignal: context.signal,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "catalog_tool_behavior_eval",
          },
        });
      });
    },
    output: ({ result }) => getTextOutput(result),
  });
}

export const mcpToolCallHarness = createMcpToolCallHarness();
