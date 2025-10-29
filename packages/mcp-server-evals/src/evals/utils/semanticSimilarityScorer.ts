import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { Score, BaseScorerOptions } from "vitest-evals";

interface SemanticSimilarityScorerOptions extends BaseScorerOptions {
  input: string;
  output: string;
  expectedTools?: Array<{ name: string; arguments: Record<string, any> }>;
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
    .describe("Score from 0 to 1 for output quality"),
  rationale: z.string().describe("Explanation of the score"),
  answersQuestion: z
    .boolean()
    .describe("Whether the output answers the user's question"),
  usesToolData: z
    .boolean()
    .describe("Whether the output correctly uses data from tool calls"),
  wellFormatted: z
    .boolean()
    .describe("Whether the output is well-formatted and readable"),
});

/**
 * A scorer that evaluates the quality of agent mode outputs using AI.
 * This scorer checks whether the agent's response:
 * - Answers the user's question
 * - Correctly uses data from tool calls
 * - Is well-formatted and helpful
 *
 * Unlike tool prediction scorers, this evaluates the final output quality
 * rather than just tool selection accuracy.
 *
 * @example
 * ```typescript
 * import { SemanticSimilarityScorer } from './utils/semanticSimilarityScorer';
 * import { AgentModeTaskRunner } from './utils/agentModeRunner';
 * import { describeEval } from 'vitest-evals';
 *
 * describeEval("list-issues (agent)", {
 *   data: async () => [
 *     {
 *       input: "What are the most common errors?",
 *       expectedTools: [
 *         { name: "find_issues", arguments: { sortBy: "count" } }
 *       ]
 *     }
 *   ],
 *   task: AgentModeTaskRunner(),
 *   scorers: [SemanticSimilarityScorer()],
 *   threshold: 0.7
 * });
 * ```
 *
 * Scoring criteria:
 * - 1.0: Perfect response - answers question, uses tool data correctly, well-formatted
 * - 0.8: Good response - minor issues with formatting or completeness
 * - 0.6: Acceptable response - answers question but with issues
 * - 0.3: Poor response - partially answers but significant problems
 * - 0.0: Incorrect or unhelpful response
 */
export function SemanticSimilarityScorer() {
  return async function SemanticSimilarityScorer(
    opts: SemanticSimilarityScorerOptions,
  ): Promise<Score> {
    const { input, output, result } = opts;

    // If result is not available (shouldn't happen with AgentModeTaskRunner),
    // fall back to just the output string
    const actualOutput = result?.result || output;
    const toolCalls = result?.toolCalls || [];

    // Build context about what tools were called
    const toolCallContext =
      toolCalls.length > 0
        ? `\n\nTools called:\n${toolCalls.map((call) => `- ${call.name}(${JSON.stringify(call.arguments)})`).join("\n")}`
        : "\n\nNo tools were called.";

    const systemPrompt = `You are evaluating the quality of an AI agent's response to a user's question.
The agent has access to Sentry MCP tools for querying issues, events, projects, and more.

Your job is to assess whether the response:
1. Answers the user's question appropriately
2. Correctly uses data from the tools that were called
3. Is well-formatted, clear, and helpful

Consider:
- Does the response address what the user asked?
- If tools were called, does the response use their data correctly?
- Is the response format appropriate (markdown, lists, tables, etc.)?
- Is the information accurate and useful?
- Are there any hallucinations or incorrect assumptions?

Score generously for good responses, but penalize:
- Hallucinations or made-up data
- Ignoring tool call results
- Not answering the question
- Poor formatting or unclear presentation

Score guidelines:
- 1.0: Perfect response - answers question completely, uses tool data correctly, well-formatted
- 0.8: Good response - minor issues with formatting, completeness, or clarity
- 0.6: Acceptable response - answers question but with noticeable issues
- 0.3: Poor response - partially answers but with significant problems
- 0.0: Incorrect, unhelpful, or completely wrong response`;

    const prompt = `[USER QUESTION]
${input}
${toolCallContext}

[AGENT RESPONSE]
${actualOutput}

Evaluate the quality of the agent's response based on the criteria above.`;

    try {
      const { object } = await generateObject({
        model: defaultModel,
        prompt,
        system: systemPrompt,
        schema: evaluationSchema,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "semantic_similarity_scorer",
        },
      });

      return {
        score: object.score,
        metadata: {
          rationale: `${object.rationale} (answers=${object.answersQuestion}, usesData=${object.usesToolData}, formatted=${object.wellFormatted}, toolCalls=${toolCalls.length})`,
          output: actualOutput,
        },
      };
    } catch (error) {
      // If evaluation fails, return a neutral score with error information
      return {
        score: null,
        metadata: {
          rationale: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  };
}
