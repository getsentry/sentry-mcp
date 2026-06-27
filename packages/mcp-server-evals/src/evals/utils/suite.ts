import { expect } from "vitest";
import {
  describeEval,
  ToolCallJudge,
  toolCalls,
  type ToolCallJudgeConfig,
  type ToolCallJudgeExpectedTool,
} from "vitest-evals";
import { createTaskHarness, type EvalTaskRunner } from "./harness";
import { McpToolCallTaskRunner } from "./mcpToolCallRunner";
import { NoOpTaskRunner } from "./runner";
import {
  ToolPredictionJudge,
  type ExpectedToolCall,
} from "./toolPredictionScorer";
import { StructuredOutputJudge } from "./structuredOutputJudge";

type EvalCase = {
  input: string;
  name?: string;
};

export type ToolPredictionEvalCase = EvalCase & {
  expectedTools: ExpectedToolCall[];
};

export type ToolCallEvalCase = EvalCase & {
  expectedTools: ToolCallJudgeExpectedTool[];
};

export type AgentEvalCase = ToolCallEvalCase & {
  expected?: Record<string, unknown>;
};

type EvalOptions = {
  threshold?: number;
};

function getCaseName(testCase: EvalCase): string {
  return testCase.name ?? testCase.input;
}

/** Defines a natural-language-to-tool-prediction eval. */
export function defineToolPredictionEval(
  name: string,
  cases: ToolPredictionEvalCase[],
  options: EvalOptions = {},
) {
  const threshold = options.threshold ?? 0.6;

  describeEval(
    name,
    {
      harness: createTaskHarness(name, NoOpTaskRunner()),
    },
    (it) => {
      for (const testCase of cases) {
        it(getCaseName(testCase), async ({ run }) => {
          const result = await run(testCase.input);

          await expect(result).toSatisfyJudge(ToolPredictionJudge(), {
            expectedTools: testCase.expectedTools,
            threshold,
          });
        });
      }
    },
  );
}

/** Defines an MCP catalog tool-call eval using the stdio mock server. */
export function defineMcpToolCallEval(
  name: string,
  cases: ToolCallEvalCase[],
  options: EvalOptions & { toolCall?: ToolCallJudgeConfig } = {},
) {
  const threshold = options.threshold ?? 0.6;

  defineToolCallEval(name, cases, McpToolCallTaskRunner(), {
    threshold,
    toolCall: options.toolCall,
  });
}

/** Defines an embedded-agent eval with tool-call and structured-output checks. */
export function defineAgentEval(
  name: string,
  cases: AgentEvalCase[],
  task: EvalTaskRunner,
  options: EvalOptions & { toolCall?: ToolCallJudgeConfig } = {},
) {
  const threshold = options.threshold ?? 0.6;
  const toolCallJudge = ToolCallJudge(options.toolCall);
  const structuredOutputJudge = StructuredOutputJudge();

  describeEval(
    name,
    {
      harness: createTaskHarness(name, task),
    },
    (it) => {
      for (const testCase of cases) {
        it(getCaseName(testCase), async ({ run }) => {
          const result = await run(testCase.input);

          if (testCase.expectedTools.length === 0) {
            expect(toolCalls(result)).toHaveLength(0);
          }

          await expect(result).toSatisfyJudge(toolCallJudge, {
            expectedTools: testCase.expectedTools,
            threshold,
          });

          if (testCase.expected) {
            await expect(result).toSatisfyJudge(structuredOutputJudge, {
              expected: testCase.expected,
              threshold,
            });
          }
        });
      }
    },
  );
}

function defineToolCallEval(
  name: string,
  cases: ToolCallEvalCase[],
  task: EvalTaskRunner,
  options: EvalOptions & { toolCall?: ToolCallJudgeConfig },
) {
  const toolCallJudge = ToolCallJudge(options.toolCall);

  describeEval(
    name,
    {
      harness: createTaskHarness(name, task),
    },
    (it) => {
      for (const testCase of cases) {
        it(getCaseName(testCase), async ({ run }) => {
          const result = await run(testCase.input);

          await expect(result).toSatisfyJudge(toolCallJudge, {
            expectedTools: testCase.expectedTools,
            threshold: options.threshold,
          });
        });
      }
    },
  );
}
