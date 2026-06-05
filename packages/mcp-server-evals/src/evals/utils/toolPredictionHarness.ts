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
  rationale: z
    .string()
    .describe("Brief explanation of why these tool calls fit the task"),
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

Return the ordered tool calls the assistant would likely make. Do not answer the user task directly.

Guidance:
- Use discovery tools when the task only gives a human name or ambiguous slug.
- If the task already provides organization/project in "org/project" form, the assistant may skip discovery when the required slugs are clear.
- The expected tool calls are the suite author's calibration for this legacy prediction case; match their sequence when provided.
- Include arguments only when they are available or strongly implied by the task.
- Extra parameters like regionUrl are acceptable only when the assistant would have learned them from an earlier discovery call.
- For natural-language search queries, preserve the user's meaning rather than inventing exact syntax.`;
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
  const judgeResult = await toolCallJudge.assess({
    ...context,
    toolCalls: predictedToolCalls,
    expectedTools: context.metadata.expectedTools,
  });

  return {
    score: judgeResult.score,
    metadata: {
      ...judgeResult.metadata,
      predictedTools: requireJsonValue(predictedToolCalls, "predictedTools"),
      expectedTools: requireJsonValue(
        normalizeExpectedToolCalls(context.metadata.expectedTools),
        "expectedTools",
      ),
      predictionRationale: context.output.rationale,
    },
  };
});

export const toolPredictionHarness = createToolPredictionHarness();
