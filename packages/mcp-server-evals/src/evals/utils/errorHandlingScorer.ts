import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { Score, BaseScorerOptions } from "vitest-evals";

interface ErrorHandlingScorerOptions extends BaseScorerOptions {
  input: string;
  output: string;
  result?: {
    result: string;
    toolCalls: Array<{ name: string; arguments: Record<string, any> }>;
  };
}

const defaultModel = openai("gpt-4o");

const evaluationSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(1)
    .describe("Score from 0 to 1 for error handling quality"),
  rationale: z.string().describe("Explanation of the score"),
  hasError: z.boolean().describe("Whether the response contains an error"),
  errorIsHelpful: z
    .boolean()
    .nullable()
    .describe("Whether the error message is helpful (null if no error)"),
  suggestsRecovery: z
    .boolean()
    .nullable()
    .describe("Whether the error suggests how to recover (null if no error)"),
});

/**
 * A scorer that evaluates error handling quality in agent mode outputs.
 * This scorer checks whether the agent:
 * - Handles errors gracefully without crashing
 * - Provides helpful error messages
 * - Suggests recovery steps when appropriate
 * - Doesn't hallucinate or provide incorrect information when facing errors
 *
 * If no error is detected, this scorer returns a perfect score.
 * If an error is detected, it evaluates the quality of error handling.
 *
 * @example
 * ```typescript
 * import { ErrorHandlingScorer } from './utils/errorHandlingScorer';
 * import { AgentModeTaskRunner } from './utils/agentModeRunner';
 * import { describeEval } from 'vitest-evals';
 *
 * describeEval("error-handling (agent)", {
 *   data: async () => [
 *     {
 *       input: "Show me issues in nonexistent-org",
 *       // Should handle gracefully with helpful error
 *     }
 *   ],
 *   task: AgentModeTaskRunner(),
 *   scorers: [ErrorHandlingScorer()],
 *   threshold: 0.7
 * });
 * ```
 *
 * Scoring criteria for error responses:
 * - 1.0: Perfect error handling - clear, helpful, suggests recovery
 * - 0.8: Good error handling - clear and helpful
 * - 0.6: Acceptable error handling - error is conveyed but could be clearer
 * - 0.3: Poor error handling - unclear or unhelpful error message
 * - 0.0: Bad error handling - hallucinations, incorrect info, or crash
 */
export function ErrorHandlingScorer() {
  return async function ErrorHandlingScorer(
    opts: ErrorHandlingScorerOptions,
  ): Promise<Score> {
    const { input, output, result } = opts;

    // Use result.result if available, otherwise fall back to output
    const actualOutput = result?.result || output;

    const systemPrompt = `You are evaluating how well an AI agent handles errors and edge cases.

Your job is to assess:
1. Is there an error or problem in the response?
2. If yes, is the error message helpful and clear?
3. Does the error suggest recovery steps?
4. Does the agent hallucinate or provide incorrect information?

Consider these patterns:
- Explicit errors: "Error: ...", "Failed to ...", "Could not ..."
- API errors: "404", "403", "permission denied", "not found"
- Graceful handling: "I couldn't find ...", "It looks like ...", "You may need to ..."
- Hallucinations: Making up data when errors occur

Good error handling:
✓ Clear explanation of what went wrong
✓ Suggestions for how to fix it
✓ Honest about limitations (e.g., "I don't have access to...")
✓ No made-up data when errors occur

Bad error handling:
✗ Vague error messages
✗ Providing incorrect information instead of admitting error
✗ Crashing or returning stack traces
✗ Not explaining what the user should do

Score guidelines for error responses:
- 1.0: Perfect - clear, helpful, suggests recovery, no hallucinations
- 0.8: Good - clear and helpful
- 0.6: Acceptable - error conveyed but could be clearer
- 0.3: Poor - unclear or unhelpful
- 0.0: Bad - hallucinations, crash, or very unhelpful

If no error is present, return score 1.0 (perfect - successful execution).`;

    const prompt = `[USER QUESTION]
${input}

[AGENT RESPONSE]
${actualOutput}

Evaluate the error handling quality of this response.`;

    try {
      const { object } = await generateObject({
        model: defaultModel,
        prompt,
        system: systemPrompt,
        schema: evaluationSchema,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "error_handling_scorer",
        },
      });

      // If no error was detected, perfect score
      if (!object.hasError) {
        return {
          score: 1.0,
          metadata: {
            rationale: "No error detected - successful execution",
            output: actualOutput,
          },
        };
      }

      return {
        score: object.score,
        metadata: {
          rationale: `${object.rationale} (helpful=${object.errorIsHelpful}, recovery=${object.suggestsRecovery})`,
          output: actualOutput,
        },
      };
    } catch (error) {
      // If evaluation fails, return neutral score
      return {
        score: null,
        metadata: {
          rationale: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  };
}
