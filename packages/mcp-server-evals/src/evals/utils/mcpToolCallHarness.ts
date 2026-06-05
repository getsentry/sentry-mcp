import { openai } from "@ai-sdk/openai";
import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import {
  generateText,
  stepCountIs,
  type LanguageModelUsage,
  type ToolExecutionOptions,
  type ToolSet,
} from "ai";
import type { Harness, HarnessRun, ToolCallRecord } from "vitest-evals";
import { toJsonValue } from "vitest-evals";
import { createFallbackSession } from "./fallbackSession";
import { toJsonRecord } from "./json";
import { withMockMcpClient } from "./mcpClient";
import type { ToolCallEvalMetadata } from "./types";

const defaultModel = openai("gpt-4o");

type AiSdkResultWithUsage = {
  text: string;
  steps?: unknown;
  totalUsage?: LanguageModelUsage;
  usage?: LanguageModelUsage;
};

type ExecutableTool = ToolSet[string] & {
  execute: (input: unknown, options: ToolExecutionOptions) => unknown;
};

function isExecutableTool(tool: ToolSet[string]): tool is ExecutableTool {
  return typeof tool.execute === "function";
}

function toToolCallError(error: unknown): NonNullable<ToolCallRecord["error"]> {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
    };
  }

  const normalized = toJsonValue(error);
  if (
    normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized) &&
    typeof normalized.message === "string"
  ) {
    return {
      ...normalized,
      type: typeof normalized.type === "string" ? normalized.type : "Error",
      message: normalized.message,
    };
  }

  return {
    type: "Error",
    message: String(error ?? "Unknown tool call error"),
  };
}

export function captureMcpToolCalls<TTools extends ToolSet>(
  tools: TTools,
  capturedToolCalls: ToolCallRecord[],
): TTools {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, tool]) => {
      if (!isExecutableTool(tool)) {
        return [toolName, tool];
      }

      const execute = tool.execute;
      const wrappedTool = {
        ...tool,
        execute: async (
          toolInput: unknown,
          execution: ToolExecutionOptions,
        ) => {
          const startedAt = new Date();
          const toolCall: ToolCallRecord = {
            id: execution.toolCallId,
            name: toolName,
            arguments: toJsonRecord(toolInput),
            startedAt: startedAt.toISOString(),
          };
          capturedToolCalls.push(toolCall);

          try {
            const result = await execute(toolInput, execution);
            const finishedAt = new Date();
            const normalizedResult = toJsonValue(result);

            if (normalizedResult !== undefined) {
              toolCall.result = normalizedResult;
            }
            toolCall.finishedAt = finishedAt.toISOString();
            toolCall.durationMs = finishedAt.getTime() - startedAt.getTime();

            return result;
          } catch (error) {
            const finishedAt = new Date();
            toolCall.error = toToolCallError(error);
            toolCall.finishedAt = finishedAt.toISOString();
            toolCall.durationMs = finishedAt.getTime() - startedAt.getTime();
            throw error;
          }
        },
      };

      return [toolName, wrappedTool];
    }),
  ) as TTools;
}

function getLastStepModel(result: AiSdkResultWithUsage) {
  const steps = Array.isArray(result.steps) ? result.steps : [];
  const lastStep = steps.at(-1);

  if (!lastStep || typeof lastStep !== "object" || !("model" in lastStep)) {
    return {};
  }

  const { model } = lastStep;
  if (!model || typeof model !== "object") {
    return {};
  }

  return {
    provider: "provider" in model ? String(model.provider) : undefined,
    model: "modelId" in model ? String(model.modelId) : undefined,
  };
}

function getTotalTokens(usage: LanguageModelUsage | undefined) {
  if (!usage) {
    return undefined;
  }

  return (
    usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  );
}

export function createMcpToolCallRun(
  input: string,
  result: AiSdkResultWithUsage,
  capturedToolCalls: ToolCallRecord[],
): HarnessRun<string> {
  const usage = result.totalUsage ?? result.usage;
  const model = getLastStepModel(result);

  return {
    session: createFallbackSession(input, result.text, capturedToolCalls),
    output: result.text,
    usage: {
      ...model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      reasoningTokens:
        usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens,
      totalTokens: getTotalTokens(usage),
      toolCalls: capturedToolCalls.length,
      metadata: toJsonRecord({
        cacheReadTokens:
          usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens,
        cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
        raw: usage?.raw,
      }),
    },
    errors: [],
  };
}

export function createMcpToolCallHarness(
  maxSteps = 6,
): Harness<string, string, ToolCallEvalMetadata> {
  return aiSdkHarness<
    undefined,
    string,
    ToolCallEvalMetadata,
    HarnessRun<string>
  >({
    name: "mcp-tool-call",
    run: async ({ input, context }) => {
      return await withMockMcpClient(async (client) => {
        const capturedToolCalls: ToolCallRecord[] = [];
        const tools = captureMcpToolCalls(
          await client.tools(),
          capturedToolCalls,
        );
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

        return createMcpToolCallRun(input, result, capturedToolCalls);
      });
    },
  });
}

export const mcpToolCallHarness = createMcpToolCallHarness();
