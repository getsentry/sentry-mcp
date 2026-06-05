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
  score: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score for the predicted tool calls from 0 to 1"),
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

export function generatePredictionPrompt(
  availableTools: string[],
  task: string,
) {
  return `You are predicting which Sentry MCP tools an AI assistant would call for a user task.

[AVAILABLE TOOLS]
${availableTools.join("\n")}

[USER TASK]
${task}

Return the ordered tool calls the assistant would likely make and a confidence score for your prediction. Do not answer the user task directly.

Guidance:
- Use only the available tool descriptions and the user task to decide.
- Predict discovery calls only when an assistant would need them before the final action.
- If the task does not require Sentry MCP tools, return an empty predictedTools array.
- Include arguments only when they are available or strongly implied by the task.
- Extra parameters like regionUrl are acceptable only when the assistant would have learned them from an earlier discovery call.
- For natural-language search queries, preserve the user's meaning rather than inventing exact syntax.

Score confidence as follows:
- 1.0: The tool sequence is obvious from the task and catalog.
- 0.8: The likely tools are clear, with minor uncertainty in arguments.
- 0.6: The broad tool choice is plausible, but ordering or arguments are uncertain.
- 0.3: A tool may be needed, but the task is ambiguous.
- 0.0: No reliable tool prediction can be made.`;
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
        prompt: generatePredictionPrompt(availableTools, input),
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
