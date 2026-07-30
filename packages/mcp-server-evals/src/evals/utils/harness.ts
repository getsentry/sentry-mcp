import {
  createHarness,
  toJsonValue,
  type Harness,
  type JsonValue,
  type TranscriptEvent,
} from "vitest-evals";

export type EvalToolCall = {
  name: string;
  arguments?: unknown;
};

export type EvalTaskResult = {
  result: string;
  toolCalls: EvalToolCall[];
};

export type EvalTaskRunner = (input: string) => Promise<EvalTaskResult>;

function toJsonObject(value: unknown): Record<string, JsonValue> | undefined {
  const normalized = toJsonValue(value);
  return normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
    ? normalized
    : undefined;
}

/** Adapts a task runner into vitest-evals output plus transcript events. */
export function createTaskHarness(
  name: string,
  task: EvalTaskRunner,
): Harness<string, string> {
  return createHarness<string, string>({
    name,
    run: async ({ input }) => {
      const result = await task(input);
      const output = result.result;
      const events: TranscriptEvent[] = [
        { type: "message", role: "user", content: input },
        ...result.toolCalls.map((call, index): TranscriptEvent => {
          const id = `tool-${index}`;
          const args = toJsonObject(call.arguments);
          return {
            type: "tool_call",
            id,
            name: call.name,
            ...(args ? { arguments: args } : {}),
          };
        }),
        { type: "message", role: "assistant", content: output },
      ];

      return {
        output,
        events,
      };
    },
  });
}
