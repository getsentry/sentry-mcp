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
 * Interface for tool pattern configuration
 */
interface ToolPatternConfig {
  patterns: RegExp[];
  antiPatterns: RegExp[];
  weightedPatterns?: Array<[RegExp, number]>;
}

/**
 * Tool usage patterns for different Sentry MCP tools
 */
const TOOL_PATTERNS: Record<string, ToolPatternConfig> = {
  find_issues: {
    patterns: [
      /^#+ Issues in \*\*/, // Heading format - HIGH CONFIDENCE
      /## [A-Z]+-[A-Z0-9]+/, // Issue ID in heading - HIGH CONFIDENCE
      /\*\*Culprit\*\*:/, // Culprit field - MEDIUM CONFIDENCE
      /issues\/[A-Z]+-[A-Z0-9]+/, // Issue URL pattern - MEDIUM CONFIDENCE
      /CLOUDFLARE-MCP-\d+/, // Issue ID pattern - MEDIUM CONFIDENCE
      /issue(?:s)? affecting/i, // Common phrasing about issues - LOW CONFIDENCE
      /\d+ issue(?:s)?/i, // Issue count - LOW CONFIDENCE
      /no issues found/i, // No issues response - LOW CONFIDENCE
    ],
    // Weighted patterns: [pattern, weight] - higher weight = more definitive
    weightedPatterns: [
      [/^#+ Issues in \*\*/, 10], // Very strong indicator
      [/## [A-Z]+-[A-Z0-9]+/, 8], // Strong issue ID pattern
      [/\*\*Culprit\*\*:/, 6], // Issue-specific field
      [/issues\/[A-Z]+-[A-Z0-9]+/, 5], // Issue URL
      [/\d+ issue(?:s)?/i, 2], // Weak - could be other tools
    ],
    antiPatterns: [
      /# Search Results for/, // search_events heading
      /\*\*📊 View these results/, // search_events link
      /Found \d+ (error|log|trace)/, // search_events count
      /```console/, // search_events log format
    ],
  },
  search_events: {
    patterns: [
      /# Search Results for/, // Main heading - HIGH CONFIDENCE
      /\*\*📊 View these results in Sentry\*\*/, // Link format - HIGH CONFIDENCE
      /Found \d+ (error|log|trace)/, // Result count - MEDIUM CONFIDENCE
      /\/explore\/(errors|logs|traces)\//, // Explorer URL - HIGH CONFIDENCE
      /## Query Translation/, // Query explanation - MEDIUM CONFIDENCE
      /```console/, // Log format - MEDIUM CONFIDENCE
    ],
    weightedPatterns: [
      [/# Search Results for/, 10], // Very strong indicator
      [/\*\*📊 View these results in Sentry\*\*/, 9], // Very strong indicator
      [/\/explore\/(discover|errors|logs|traces)\//, 8], // Strong URL pattern
      [/Found \d+ (error|log|trace)/, 6], // Good result pattern
      [/```console/, 4], // Log format
    ],
    antiPatterns: [
      /^#+ Issues in \*\*/, // find_issues heading
      /## [A-Z]+-[A-Z0-9]+/, // find_issues ID pattern
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
    weightedPatterns: [
      [/# Issue Details:/, 10], // Very strong indicator
      [/## Error Details/, 8], // Strong section indicator
      [/## Stack Trace/, 7], // Strong indicator for issue details
      [/\*\*Seer Analysis\*\*/, 6], // Specific to issue details
      [/\*\*Issue ID\*\*:/, 4], // Could overlap with find_issues
    ],
    antiPatterns: [
      /^#+ Issues in \*\*/, // find_issues heading
      /# Search Results for/, // search_events heading
    ],
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
    weightedPatterns: [
      [/# Project Created Successfully/, 10], // Very strong indicator
      [/\*\*Project Slug\*\*:/, 8], // Strong project-specific indicator
      [/\*\*Team\*\*:/, 6], // Often included in project creation
      [/\*\*DSN\*\*:/, 4], // Shared with create_dsn
    ],
    antiPatterns: [
      /# New DSN in/, // create_dsn heading
      /# DSN Created Successfully/, // create_dsn heading
    ],
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
    weightedPatterns: [
      [/# New DSN in/, 10], // Very strong indicator (actual output format)
      [/# DSN Created Successfully/, 9], // Strong indicator
      [/ingest.*sentry\.io/, 7], // Strong DSN URL pattern
      [/\*\*Name\*\*:/, 5], // DSN name field
      [/\*\*DSN\*\*:/, 4], // Shared with create_project
    ],
    antiPatterns: [
      /# Project Created Successfully/, // create_project heading
      /\*\*Project Slug\*\*:/, // create_project field
    ],
  },
  create_team: {
    patterns: [
      /# Team Created Successfully/,
      /\*\*Team Name\*\*:/,
      /\*\*Team Slug\*\*:/,
    ],
    weightedPatterns: [
      [/# New Team in/, 10], // Very strong indicator (actual output format)
      [/# Team Created Successfully/, 9], // Strong indicator
      [/\*\*Team Slug\*\*:/, 8], // Strong team-specific indicator
      [/\*\*Team Name\*\*:/, 7], // Team-specific field
    ],
    antiPatterns: [
      /# Project Created Successfully/, // create_project
      /# New DSN in/, // create_dsn
    ],
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
 * Enhanced version supporting:
 * - Multiple valid tools
 * - Weighted pattern matching
 * - More flexible scoring
 *
 * Usage:
 * ```typescript
 * // Single expected tool
 * scorers: [ToolUsage("find_issues"), Factuality()]
 *
 * // Multiple valid tools (either is acceptable)
 * scorers: [ToolUsage(["search_events", "find_issues"]), Factuality()]
 *
 * // Any known tool
 * scorers: [ToolUsage(), Factuality()]
 * ```
 */
export function ToolUsage(
  expectedTools?: keyof typeof TOOL_PATTERNS | (keyof typeof TOOL_PATTERNS)[],
) {
  return async function ToolUsage2(opts: {
    input: string;
    output: string;
    expected?: string;
  }) {
    const output = opts.output || "";

    // Normalize expectedTools to always be an array
    const expectedToolsArray: (keyof typeof TOOL_PATTERNS)[] = expectedTools
      ? Array.isArray(expectedTools)
        ? expectedTools
        : [expectedTools]
      : [];

    // Get tool detection results with confidence scores
    const detectionResults = detectToolWithConfidence(output);

    if (expectedToolsArray.length > 0) {
      // Check if any of the expected tools were detected with good confidence
      for (const expectedTool of expectedToolsArray) {
        const result = detectionResults.find((r) => r.tool === expectedTool);
        if (result) {
          if (result.confidence >= 0.8) {
            return {
              score: 1.0,
              metadata: {
                rationale: `Tool ${expectedTool} was correctly used (high confidence: ${Math.round(result.confidence * 100)}%)`,
                detectedTool: result.tool,
                confidence: result.confidence,
              },
            };
          }
          if (result.confidence >= 0.5) {
            return {
              score: 0.8,
              metadata: {
                rationale: `Tool ${expectedTool} was likely used (medium confidence: ${Math.round(result.confidence * 100)}%)`,
                detectedTool: result.tool,
                confidence: result.confidence,
              },
            };
          }
          if (result.confidence >= 0.3) {
            return {
              score: 0.5,
              metadata: {
                rationale: `Tool ${expectedTool} patterns found but low confidence (${Math.round(result.confidence * 100)}%)`,
                detectedTool: result.tool,
                confidence: result.confidence,
              },
            };
          }
        }
      }

      // If none of the expected tools were detected, check what was detected
      const bestDetection = detectionResults[0]; // Sorted by confidence
      if (bestDetection && bestDetection.confidence >= 0.6) {
        return {
          score: 0,
          metadata: {
            rationale: `Expected ${expectedToolsArray.join(" or ")} but detected ${bestDetection.tool}`,
            detectedTool: bestDetection.tool,
            confidence: bestDetection.confidence,
          },
        };
      }
      return {
        score: 0,
        metadata: {
          rationale: `Expected ${expectedToolsArray.join(" or ")} but no clear tool detected`,
          detectedTool: bestDetection?.tool || null,
          confidence: bestDetection?.confidence || 0,
        },
      };
    }
    // Just verify that SOME known tool was used
    const bestDetection = detectionResults[0];
    if (bestDetection && bestDetection.confidence >= 0.5) {
      return {
        score: 1,
        metadata: {
          rationale: `A recognized tool was used: ${bestDetection.tool} (confidence: ${Math.round(bestDetection.confidence * 100)}%)`,
          detectedTool: bestDetection.tool,
          confidence: bestDetection.confidence,
        },
      };
    }
    return {
      score: 0,
      metadata: {
        rationale: "No recognized tool output pattern found in the response",
        detectedTool: bestDetection?.tool || null,
        confidence: bestDetection?.confidence || 0,
      },
    };
  };
}

/**
 * Enhanced tool detection with weighted patterns and confidence scores
 */
function detectToolWithConfidence(output: string): Array<{
  tool: keyof typeof TOOL_PATTERNS;
  confidence: number;
  score: number;
}> {
  const results: Array<{
    tool: keyof typeof TOOL_PATTERNS;
    confidence: number;
    score: number;
  }> = [];

  for (const [tool, config] of Object.entries(TOOL_PATTERNS)) {
    const toolKey = tool as keyof typeof TOOL_PATTERNS;

    // Calculate weighted score if weighted patterns exist, otherwise use simple count
    let weightedScore = 0;
    let maxPossibleScore = 0;

    if (config.weightedPatterns && config.weightedPatterns.length > 0) {
      // Use weighted patterns for more accurate detection
      for (const [pattern, weight] of config.weightedPatterns) {
        maxPossibleScore += weight;
        if (pattern.test(output)) {
          weightedScore += weight;
        }
      }
    } else {
      // Fallback to simple pattern counting
      const matchCount = config.patterns.filter((pattern) =>
        pattern.test(output),
      ).length;
      weightedScore = matchCount * 5; // Give each pattern a weight of 5
      maxPossibleScore = config.patterns.length * 5;
    }

    // Subtract points for anti-patterns
    const antiMatchCount = config.antiPatterns.filter((pattern) =>
      pattern.test(output),
    ).length;
    weightedScore -= antiMatchCount * 10; // Heavy penalty for anti-patterns

    // Calculate confidence as percentage of max possible score
    const confidence =
      maxPossibleScore > 0
        ? Math.max(0, Math.min(1, weightedScore / maxPossibleScore))
        : 0;

    if (weightedScore > 0) {
      results.push({
        tool: toolKey,
        confidence,
        score: weightedScore,
      });
    }
  }

  // Sort by confidence (highest first)
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Legacy function for backward compatibility
 */
function detectTool(output: string): keyof typeof TOOL_PATTERNS | null {
  const results = detectToolWithConfidence(output);
  return results.length > 0 && results[0].confidence >= 0.3
    ? results[0].tool
    : null;
}
