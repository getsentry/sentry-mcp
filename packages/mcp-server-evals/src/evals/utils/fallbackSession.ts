import type {
  JsonValue,
  NormalizedSession,
  ToolCallRecord,
} from "vitest-evals";

export function createFallbackSession(
  input: string,
  output: JsonValue,
  toolCalls: ToolCallRecord[] = [],
): NormalizedSession {
  return {
    messages: [
      {
        role: "user",
        content: input,
      },
      {
        role: "assistant",
        content: output,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
    ],
  };
}

function hasHarnessStepModel(step: unknown) {
  if (!step || typeof step !== "object" || !("model" in step)) {
    return false;
  }

  const { model } = step;
  if (!model || typeof model !== "object") {
    return false;
  }

  return (
    "provider" in model &&
    typeof model.provider === "string" &&
    "modelId" in model &&
    typeof model.modelId === "string"
  );
}

export function withFallbackSession<Result extends { steps?: unknown[] }>(
  input: string,
  result: Result,
  output: JsonValue,
  toolCalls: ToolCallRecord[] = [],
) {
  const session = createFallbackSession(input, output, toolCalls);

  if (
    Array.isArray(result.steps) &&
    result.steps.length > 0 &&
    result.steps.every(hasHarnessStepModel)
  ) {
    return {
      ...result,
      session,
    };
  }

  return {
    ...result,
    steps: undefined,
    session,
  };
}
