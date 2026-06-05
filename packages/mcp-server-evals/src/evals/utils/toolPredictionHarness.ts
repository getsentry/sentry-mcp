import { openai } from "@ai-sdk/openai";
import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import { generateObject, type GenerateObjectResult } from "ai";
import {
  createJudge,
  ToolCallJudge,
  type JudgeContext,
  type JsonValue,
  type ToolCallRecord,
} from "vitest-evals";
import { z } from "zod";
import { requireJsonValue, toJsonRecord } from "./json";
import { getAvailableToolDescriptions } from "./mcpClient";
import type {
  ExpectedToolCall,
  PredictedToolCall,
  ToolPredictionMetadata,
  ToolPredictionOutput,
} from "./types";

const defaultModel = openai("gpt-4o");

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const shallowJsonValueSchema = z.union([
  jsonPrimitiveSchema,
  z.array(jsonPrimitiveSchema),
  z.record(jsonPrimitiveSchema),
]);
const jsonValueSchema: z.ZodType<JsonValue> = z.union([
  shallowJsonValueSchema,
  z.array(shallowJsonValueSchema),
  z.record(shallowJsonValueSchema),
]);

const predictionSchema = z.object({
  score: z.number().min(0).max(1).describe("Score from 0 to 1"),
  rationale: z
    .string()
    .describe("Brief explanation of the score and predicted tool calls"),
  predictedTools: z
    .array(
      z.object({
        name: z.string().describe("Sentry MCP tool name"),
        arguments: z.record(jsonValueSchema).optional().default({}),
      }),
    )
    .describe("Ordered Sentry MCP tool calls the assistant would likely make"),
});

type RawToolPredictionOutput = z.infer<typeof predictionSchema>;
type ToolPredictionResult = GenerateObjectResult<RawToolPredictionOutput>;

function describeExpectedToolCalls(expectedTools: ExpectedToolCall[] = []) {
  if (expectedTools.length === 0) {
    return "No tool calls are expected.";
  }

  return expectedTools
    .map(
      (tool) =>
        `- ${tool.name} with arguments: ${JSON.stringify(tool.arguments ?? {})}`,
    )
    .join("\n");
}

function generatePredictionPrompt(
  availableTools: string[],
  task: string,
  expectedTools: ExpectedToolCall[] = [],
) {
  return `You are predicting which Sentry MCP tools an AI assistant would call for a user task.

[AVAILABLE TOOLS]
${availableTools.join("\n")}

[USER TASK]
${task}

[EXPECTED TOOL CALLS]
${describeExpectedToolCalls(expectedTools)}

Return the ordered tool calls the assistant would likely make and a score for how well they match the expected calls. Do not answer the user task directly.

Guidance:
- The expected tool calls show what is actually expected for this specific legacy prediction case; follow them exactly when provided.
- If expected tools include discovery calls, predict discovery calls.
- If expected tools do not include discovery calls, do not predict them.
- Include arguments only when they are available or strongly implied by the task.
- Extra parameters like regionUrl are acceptable only when the assistant would have learned them from an earlier discovery call.
- For natural-language search queries, preserve the user's meaning rather than inventing exact syntax.

Score as follows:
- 1.0: All expected tools would be called with correct arguments in the right order.
- 0.8: All expected tools would be called, with minor differences like extra params.
- 0.6: Most expected tools would be called but some are missing or in the wrong order.
- 0.3: Some expected tools would be called but there are significant issues.
- 0.0: Wrong tools or critical tools missing.`;
}

function normalizePredictedToolCall(
  toolCall: RawToolPredictionOutput["predictedTools"][number],
): PredictedToolCall {
  return {
    name: toolCall.name,
    arguments: toJsonRecord(toolCall.arguments),
  };
}

function normalizePredictionOutput(
  output: RawToolPredictionOutput,
): ToolPredictionOutput {
  return {
    score: output.score,
    rationale: output.rationale,
    predictedTools: output.predictedTools.map(normalizePredictedToolCall),
  };
}

function toToolCallRecord(toolCall: PredictedToolCall): ToolCallRecord {
  return {
    name: toolCall.name,
    arguments: toolCall.arguments,
  };
}

function normalizeExpectedToolCalls(expectedTools: ExpectedToolCall[] = []) {
  return expectedTools.map((toolCall) => ({
    name: toolCall.name,
    arguments: toJsonRecord(toolCall.arguments),
  }));
}

export function createToolPredictionHarness() {
  return aiSdkHarness<
    undefined,
    string,
    ToolPredictionMetadata,
    ToolPredictionResult,
    Record<string, never>,
    ToolPredictionOutput
  >({
    name: "tool-prediction",
    run: async ({ input, context }) => {
      const availableTools = await getAvailableToolDescriptions();
      context.setArtifact("availableTools", availableTools);

      return await generateObject({
        model: defaultModel,
        prompt: generatePredictionPrompt(
          availableTools,
          input,
          context.metadata.expectedTools,
        ),
        schema: predictionSchema,
        abortSignal: context.signal,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "tool_prediction_harness",
        },
      });
    },
    output: ({ result }) => normalizePredictionOutput(result.object),
  });
}

const toolCallJudge = ToolCallJudge({
  ordered: true,
  params: "fuzzy",
  requireAll: false,
});

export const ToolPredictionJudge = createJudge<
  JudgeContext<string, ToolPredictionOutput, ToolPredictionMetadata>
>("ToolPredictionJudge", async (context) => {
  const predictedToolCalls =
    context.output.predictedTools.map(toToolCallRecord);
  const toolCallJudgeResult = await toolCallJudge.assess({
    ...context,
    toolCalls: predictedToolCalls,
    expectedTools: context.metadata.expectedTools,
  });
  const deterministicScore = toolCallJudgeResult.score ?? 0;

  return {
    score: deterministicScore,
    metadata: {
      ...toolCallJudgeResult.metadata,
      rationale: context.output.rationale,
      modelScore: context.output.score,
      predictedTools: requireJsonValue(predictedToolCalls, "predictedTools"),
      expectedTools: requireJsonValue(
        normalizeExpectedToolCalls(context.metadata.expectedTools),
        "expectedTools",
      ),
      deterministicScore,
      deterministicRationale: toolCallJudgeResult.metadata?.rationale,
    },
  };
});

export const toolPredictionHarness = createToolPredictionHarness();
