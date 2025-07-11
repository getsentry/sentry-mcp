import { openai } from "@ai-sdk/openai";
import {
  experimental_createMCPClient,
  generateObject,
  streamText,
  type LanguageModel,
} from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { z } from "zod";

/**
 * IMPORTANT: Keep evaluation tests minimal!
 *
 * Each eval test takes 30+ seconds to run and costs API credits.
 * Only create evaluation tests for the core use cases of each tool:
 * - Primary functionality (e.g., resolving an issue)
 * - Alternative input methods (e.g., using issue URL vs org+issueId)
 * - One complex workflow example if applicable
 *
 * Avoid testing edge cases, error conditions, or minor variations in evals.
 * Use unit tests (tools.test.ts) for comprehensive coverage instead.
 */

const SYSTEM_PROMPT = `You are an assistant responsible for evaluating the results of calling various tools. 

You a general purpose LLM-based Agent. Your purpose is to answer the user's query using the tools provided.

- You should ONLY use the tools available to answer the user's query.
- Use as few tool calls as possible to get to the answer.
- Using multiple tool calls to get to the answer is allowed when needed.
`;

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

export interface TaskRunnerOptions {
  model?: LanguageModel;
  logToolCalls?: boolean;
}

export function TaskRunner(options: TaskRunnerOptions | LanguageModel = {}) {
  // Handle legacy API where model was passed directly
  const isLegacyModel = typeof options === "object" && "modelId" in options;
  const { model = defaultModel, logToolCalls = true } = isLegacyModel
    ? { model: options as LanguageModel }
    : (options as TaskRunnerOptions);

  return async function TaskRunner(input: string) {
    const transport = new Experimental_StdioMCPTransport({
      command: "npm",
      args: ["run", "start"],
      env: {
        SENTRY_ACCESS_TOKEN: process.env.SENTRY_ACCESS_TOKEN!,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
      },
    });
    const mcpClient = await experimental_createMCPClient({
      transport,
    });

    const tools = await mcpClient.tools();
    const toolCalls: Array<{ toolName: string; args: any }> = [];

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
        onStepFinish: (event) => {
          if (logToolCalls && event.toolCalls && event.toolCalls.length > 0) {
            for (const call of event.toolCalls) {
              console.log(`\n🔧 Tool called: ${call.toolName}`);
              console.log(`   Args: ${JSON.stringify(call.args, null, 2)}`);
              toolCalls.push({ toolName: call.toolName, args: call.args });
            }
          }
        },
      });

      for await (const _ of result.fullStream) {
      }

      const text = await result.text;

      // Log summary if enabled
      if (logToolCalls && toolCalls.length > 0) {
        console.log(`\n📊 Tool call summary:`);
        let idx = 0;
        for (const call of toolCalls) {
          console.log(`   ${idx + 1}. ${call.toolName}`);
          idx++;
        }
      }

      return text;
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

/**
 * Tool usage patterns for different Sentry MCP tools
 */
const TOOL_PATTERNS = {
  find_issues: {
    patterns: [
      /^#+ Issues in \*\*/, // Heading format
      /\*\*Issue ID\*\*:/, // Issue ID field
      /\*\*Culprit\*\*:/, // Culprit field
      /issues\/[A-Z]+-[A-Z0-9]+/, // Issue URL pattern
      /## [A-Z]+-[A-Z0-9]+/, // Issue ID in heading
      /CLOUDFLARE-MCP-\d+/, // Issue ID pattern
      /issue(?:s)? affecting/i, // Common phrasing about issues
      /\d+ issue(?:s)?/i, // Issue count
      /no issues found/i, // No issues response
    ],
    antiPatterns: [
      /# Search Results for/, // search_events heading
      /\*\*📊 View these results/, // search_events link
      /Found \d+ (error|log|trace)/, // search_events count
    ],
  },
  search_events: {
    patterns: [
      /# Search Results for/, // Main heading
      /\*\*📊 View these results in Sentry\*\*/, // Link format
      /Found \d+ (error|log|trace)/, // Result count
      /\/explore\/(errors|logs|traces)\//, // Explorer URL
      /## Query Translation/, // Query explanation
      /```console/, // Log format
    ],
    antiPatterns: [
      /^#+ Issues in \*\*/, // find_issues heading
      /\*\*Culprit\*\*:/, // find_issues field
    ],
  },
  get_issue_details: {
    patterns: [
      /# Issue Details:/, // Main heading
      /## Error Details/, // Section heading
      /\*\*Issue ID\*\*:/, // Issue field
      /## Stack Trace/, // Stack trace section
      /\*\*Seer Analysis\*\*/, // Seer analysis
    ],
    antiPatterns: [],
  },
  find_organizations: {
    patterns: [
      /# Organizations/, // Main heading
      /\*\*Organization\*\*:/, // Org field
      /\*\*Slug\*\*:/, // Slug field
    ],
    antiPatterns: [],
  },
  create_project: {
    patterns: [
      /# Project Created Successfully/,
      /\*\*DSN\*\*:/,
      /\*\*Project Slug\*\*:/,
    ],
    antiPatterns: [],
  },
  update_issue: {
    patterns: [/# Issue Updated/, /\*\*Status\*\*:/, /\*\*Updated Issue\*\*:/],
    antiPatterns: [],
  },
  whoami: {
    patterns: [/# Authenticated User/, /\*\*Name\*\*:/, /\*\*Email\*\*:/],
    antiPatterns: [],
  },
  create_dsn: {
    patterns: [
      /# DSN Created Successfully/,
      /\*\*DSN\*\*:/,
      /\*\*Name\*\*:/,
      /ingest.*sentry\.io/,
    ],
    antiPatterns: [],
  },
  create_team: {
    patterns: [
      /# Team Created Successfully/,
      /\*\*Team Name\*\*:/,
      /\*\*Team Slug\*\*:/,
    ],
    antiPatterns: [],
  },
  find_dsns: {
    patterns: [
      /# DSNs for/,
      /\*\*DSN\*\*:/,
      /\*\*Name\*\*:/,
      /ingest.*sentry\.io/,
    ],
    antiPatterns: [],
  },
  find_projects: {
    patterns: [
      /# Projects in/,
      /\*\*Project\*\*:/,
      /\*\*Slug\*\*:/,
      /\*\*Platform\*\*:/,
    ],
    antiPatterns: [],
  },
  find_releases: {
    patterns: [
      /# Releases/,
      /\*\*Version\*\*:/,
      /\*\*Created\*\*:/,
      /\*\*Projects\*\*:/,
    ],
    antiPatterns: [],
  },
  find_tags: {
    patterns: [
      /# Common Tags in/,
      /\*\*Tag\*\*:/,
      /\*\*Key\*\*:/,
      /browser\.name/,
      /os\.name/,
    ],
    antiPatterns: [],
  },
  find_teams: {
    patterns: [
      /# Teams in/,
      /\*\*Team\*\*:/,
      /\*\*Slug\*\*:/,
      /\*\*Member Count\*\*:/,
    ],
    antiPatterns: [],
  },
  search_docs: {
    patterns: [
      /# Documentation Search Results/,
      /\*\*Query\*\*:/,
      /Found \d+ relevant/,
      /platforms\//,
      /guides\//,
    ],
    antiPatterns: [],
  },
  update_project: {
    patterns: [
      /# Project Updated/,
      /\*\*Updated Project\*\*:/,
      /\*\*Slug\*\*:/,
      /\*\*Name\*\*:/,
    ],
    antiPatterns: [],
  },
  analyze_issue_with_seer: {
    patterns: [
      /# Seer Analysis/,
      /## Root Cause/,
      /## Suggested Fix/,
      /\*\*Analysis\*\*:/,
    ],
    antiPatterns: [],
  },
};

/**
 * A scorer that verifies the correct tool was used based on output patterns.
 *
 * Usage:
 * ```typescript
 * scorers: [ToolUsage("find_issues"), Factuality()]
 * ```
 *
 * Or to just check that ANY known tool was used:
 * ```typescript
 * scorers: [ToolUsage()]
 * ```
 */
export function ToolUsage(expectedTool?: keyof typeof TOOL_PATTERNS) {
  return async function ToolUsage(opts: {
    input: string;
    output: string;
    expected?: string;
  }) {
    const output = opts.output || "";

    // If a specific tool is expected, check for it
    if (expectedTool) {
      const toolConfig = TOOL_PATTERNS[expectedTool];
      if (!toolConfig) {
        return {
          score: 0,
          metadata: {
            error: `Unknown tool: ${expectedTool}`,
          },
        };
      }

      // Check if output matches expected tool patterns
      const matchesPatterns = toolConfig.patterns.some((pattern) =>
        pattern.test(output),
      );

      // Check if output contains anti-patterns (indicators of wrong tool)
      const hasAntiPatterns = toolConfig.antiPatterns.some((pattern) =>
        pattern.test(output),
      );

      if (matchesPatterns && !hasAntiPatterns) {
        return {
          score: 1,
          metadata: {
            rationale: `Tool ${expectedTool} was correctly used (high confidence)`,
          },
        };
      }
      if (matchesPatterns && hasAntiPatterns) {
        return {
          score: 0.5,
          metadata: {
            rationale: `Tool ${expectedTool} patterns found but output also contains patterns from other tools (medium confidence)`,
          },
        };
      }
      // Try to detect which tool was actually used
      const detectedTool = detectTool(output);
      return {
        score: 0,
        metadata: {
          rationale: `Expected ${expectedTool} but detected ${detectedTool || "unknown tool"}`,
          output: detectedTool
            ? `Detected tool: ${detectedTool}`
            : "No recognized tool pattern found",
        },
      };
    }
    // Just verify that SOME known tool was used
    const detectedTool = detectTool(output);
    if (detectedTool) {
      return {
        score: 1,
        metadata: {
          rationale: `A recognized tool was used: ${detectedTool}`,
        },
      };
    }
    return {
      score: 0,
      metadata: {
        rationale: "No recognized tool output pattern found in the response",
      },
    };
  };
}

/**
 * Detect which tool was used based on output patterns
 */
function detectTool(output: string): keyof typeof TOOL_PATTERNS | null {
  let bestMatch: { tool: keyof typeof TOOL_PATTERNS; score: number } | null =
    null;

  for (const [tool, config] of Object.entries(TOOL_PATTERNS)) {
    const matchCount = config.patterns.filter((pattern) =>
      pattern.test(output),
    ).length;

    const antiMatchCount = config.antiPatterns.filter((pattern) =>
      pattern.test(output),
    ).length;

    const score = matchCount - antiMatchCount;

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { tool: tool as keyof typeof TOOL_PATTERNS, score };
    }
  }

  return bestMatch?.tool || null;
}
