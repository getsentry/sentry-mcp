import type { JsonValue } from "vitest-evals";

export type JsonRecord = Record<string, JsonValue>;

export interface ExpectedToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export type PredictedToolCall = {
  name: string;
  arguments?: JsonRecord;
};

export type ToolPredictionOutput = {
  rationale: string;
  predictedTools: PredictedToolCall[];
};

export type ToolPredictionMetadata = Record<string, unknown> & {
  expectedTools?: ExpectedToolCall[];
};

export type ToolCallEvalMetadata = Record<string, unknown> & {
  expectedTools?: ExpectedToolCall[];
};

export type StructuredEvalMetadata = ToolCallEvalMetadata & {
  expected?: Record<string, unknown>;
};

export type EvalCase<TMetadata extends Record<string, unknown>> = {
  input: string;
  name?: string;
} & TMetadata;
