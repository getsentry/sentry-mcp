import {
  describeEval,
  StructuredOutputJudge,
  ToolCallJudge,
  type Harness,
  type JsonValue,
} from "vitest-evals";
import {
  ToolPredictionJudge,
  toolPredictionHarness,
} from "./toolPredictionHarness";
import { mcpToolCallHarness } from "./mcpToolCallHarness";
import type {
  EvalCase,
  StructuredEvalMetadata,
  ToolCallEvalMetadata,
  ToolPredictionMetadata,
} from "./types";

type EvalOptions = {
  threshold?: number | null;
  timeout?: number;
};

function resolveThreshold(
  threshold: number | null | undefined,
  defaultThreshold: number,
) {
  return threshold === undefined ? defaultThreshold : threshold;
}

export function describeToolPredictionEval(
  name: string,
  cases: EvalCase<ToolPredictionMetadata>[],
  options: EvalOptions = {},
) {
  describeEval(
    name,
    {
      harness: toolPredictionHarness,
      judges: [ToolPredictionJudge],
      judgeThreshold: resolveThreshold(options.threshold, 0.6),
    },
    (it) => {
      for (const testCase of cases) {
        const { input, name: testName, ...metadata } = testCase;

        it(
          testName ?? input,
          { timeout: options.timeout ?? 30000 },
          async ({ run }) => {
            await run(input, { metadata });
          },
        );
      }
    },
  );
}

export function describeMcpToolCallEval(
  name: string,
  cases: EvalCase<ToolCallEvalMetadata>[],
  options: EvalOptions = {},
) {
  describeEval(
    name,
    {
      harness: mcpToolCallHarness,
      judges: [ToolCallJudge({ ordered: true, params: "fuzzy" })],
      judgeThreshold: resolveThreshold(options.threshold, 0.6),
    },
    (it) => {
      for (const testCase of cases) {
        const { input, name: testName, ...metadata } = testCase;

        it(
          testName ?? input,
          { timeout: options.timeout ?? 90000 },
          async ({ run }) => {
            await run(input, { metadata });
          },
        );
      }
    },
  );
}

export function describeSearchAgentEval(
  name: string,
  harness: Harness<string, JsonValue, StructuredEvalMetadata>,
  cases: EvalCase<StructuredEvalMetadata>[],
  options: EvalOptions = {},
) {
  describeEval(
    name,
    {
      harness,
      judges: [
        ToolCallJudge({ params: "fuzzy" }),
        StructuredOutputJudge({ match: "fuzzy" }),
      ],
      judgeThreshold: resolveThreshold(options.threshold, 0.6),
    },
    (it) => {
      for (const testCase of cases) {
        const { input, name: testName, ...metadata } = testCase;

        it(
          testName ?? input,
          { timeout: options.timeout ?? 150000 },
          async ({ run }) => {
            await run(input, { metadata });
          },
        );
      }
    },
  );
}
