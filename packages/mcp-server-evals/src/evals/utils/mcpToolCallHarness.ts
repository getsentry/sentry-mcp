import { openai } from "@ai-sdk/openai";
import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import { generateText, stepCountIs } from "ai";
import type { ToolCallRecord } from "vitest-evals";
import { withFallbackSession } from "./fallbackSession";
import { requireJsonValue, toJsonRecord } from "./json";
import { withMockMcpClient } from "./mcpClient";
import type { ToolCallEvalMetadata } from "./types";

const defaultModel = openai("gpt-4o");

type AiSdkToolCall = {
  toolName?: unknown;
  name?: unknown;
  args?: unknown;
  input?: unknown;
};

type McpToolCallResult = {
  text?: unknown;
  toolCalls?: unknown;
  steps?: unknown[];
};

function getTextOutput(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "text" in result &&
    typeof result.text === "string"
  ) {
    return result.text;
  }

  return "";
}

function toToolCallRecord(call: AiSdkToolCall): ToolCallRecord | null {
  const name =
    typeof call.toolName === "string"
      ? call.toolName
      : typeof call.name === "string"
        ? call.name
        : null;

  if (!name) {
    return null;
  }

  return {
    name,
    arguments: toJsonRecord(call.input ?? call.args),
  };
}

function normalizeToolCalls(toolCalls: unknown): ToolCallRecord[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.flatMap((call) => {
    if (!call || typeof call !== "object") {
      return [];
    }

    const record = toToolCallRecord(call);
    return record ? [record] : [];
  });
}

function getStepToolCalls(result: McpToolCallResult): ToolCallRecord[] {
  if (!Array.isArray(result.steps)) {
    return [];
  }

  return result.steps.flatMap((step) => {
    if (!step || typeof step !== "object" || !("toolCalls" in step)) {
      return [];
    }

    return normalizeToolCalls(step.toolCalls);
  });
}

function getToolCalls(result: McpToolCallResult): ToolCallRecord[] {
  const topLevelToolCalls = normalizeToolCalls(result.toolCalls);
  return topLevelToolCalls.length > 0
    ? topLevelToolCalls
    : getStepToolCalls(result);
}

export function createMcpToolCallHarness(maxSteps = 6) {
  return aiSdkHarness<
    undefined,
    string,
    ToolCallEvalMetadata,
    McpToolCallResult,
    Record<string, never>,
    string
  >({
    name: "mcp-tool-call",
    run: async ({ input, context }) => {
      return await withMockMcpClient(async (client) => {
        const tools = await client.tools();

        const result = await generateText({
          model: defaultModel,
          tools,
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

        return withFallbackSession(
          input,
          result,
          requireJsonValue(getTextOutput(result), "MCP tool-call output"),
          getToolCalls(result),
        );
      });
    },
    output: ({ result }) => getTextOutput(result),
  });
}

export const mcpToolCallHarness = createMcpToolCallHarness();
