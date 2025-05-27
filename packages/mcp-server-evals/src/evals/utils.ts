import { openai } from "@ai-sdk/openai";
import {
  experimental_createMCPClient,
  generateObject,
  streamText,
  type LanguageModel,
} from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { z } from "zod";

const SYSTEM_PROMPT = `You are an assistant responsible for evaluating the results of calling various tools. Given the user's query, use the tools available to you to answer the question.

You are emulating the behavior of an LLM-based Agent which is utilizing the set of tools provided to it, and you should use as few tools as possible to answer the question.`;

export const FIXTURES = {
  organizationSlug: "sentry-mcp-evals",
  teamSlug: "the-goats",
  projectSlug: "cloudflare-mcp",
  issueId: "CLOUDFLARE-MCP-41",
  issueUrl: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/",
  testIssueUrl: "https://sentry-mcp-evals.sentry.io/issues/PEATED-A8/",
  dsn: "https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945",
};

const defaultModel = openai("gpt-4o");

export function TaskRunner(model: LanguageModel = defaultModel) {
  return async function TaskRunner(input: string) {
    const transport = new Experimental_StdioMCPTransport({
      command: "npm",
      args: ["run", "start"],
      env: {
        SENTRY_ACCESS_TOKEN: process.env.SENTRY_ACCESS_TOKEN!,
      },
    });
    const mcpClient = await experimental_createMCPClient({
      transport,
    });

    const tools = await mcpClient.tools();

    try {
      const result = streamText({
        model,
        tools,
        system: SYSTEM_PROMPT,
        prompt: input,
        maxRetries: 1,
        maxSteps: 10,
        experimental_telemetry: {
          isEnabled: true,
        },
        onError: (error) => {
          console.error(error);
        },
      });

      for await (const _ of result.fullStream) {
      }

      return await result.text;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      await mcpClient.close();
    }
  };
}

/**
 * A Factuality checker utilizing the `ai` SDK based on the implementation in `autoevals`.
 *
 * ```
 * import { openai } from "@ai-sdk/openai";
 *
 * scorers: [Factuality(openai("gpt-4o"))]
 * ```
 */
export function Factuality(model: LanguageModel = defaultModel) {
  return async function Factuality(opts: {
    input: string;
    output: string;
    expected?: string;
  }) {
    const { object } = await generateObject({
      model,
      /**
       * Prompt implementation from `autoevals`:
       *
       * {@link https://github.com/braintrustdata/autoevals/blob/5aa20a0a9eb8fc9e07e9e5722ebf71c68d082f32/templates/factuality.yaml}
       */
      prompt: `
        You are comparing a submitted answer to an expert answer on a given question. Here is the data:

        [BEGIN DATA]
        ************
        [Question]: ${opts.input}
        ************
        [Expert]: ${opts.expected}
        ************
        [Submission]: ${opts.output}
        ************
        [END DATA]

        Compare the factual content of the submitted answer with the expert answer. Ignore any differences in style, grammar, or punctuation, or overall structure.

        The submitted answer may either be a subset or superset of the expert answer, or it may conflict with it. Determine which case applies. Answer the question by selecting one of the following options:
        
        (A) The submitted answer is a subset of the expert answer and is fully consistent with it.
        (B) The submitted answer is a superset of the expert answer and is fully consistent with it.
        (C) The submitted answer contains all the same details as the expert answer.
        (D) There is a disagreement between the submitted answer and the expert answer.
        (E) The answers differ, but these differences don't matter from the perspective of factuality.
      `,
      schema: z.object({
        answer: z.enum(["A", "B", "C", "D", "E"]).describe("Your selection."),
        rationale: z
          .string()
          .describe("Why you chose this answer. Be very detailed."),
      }),
    });

    const scores = {
      A: 0.4,
      B: 0.6,
      C: 1,
      D: 0,
      E: 1,
    };

    return {
      score: scores[object.answer],
      metadata: {
        rationale: object.rationale,
      },
    };
  };
}
