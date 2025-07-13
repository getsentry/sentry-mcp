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
  testIssueUrl: "https://sentry-mcp-evals.sentry.io/issues/PEATED-A8",
  dsn: "https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945",
};

const defaultModel = openai("gpt-4o");

// No longer needed - we return tool calls directly in TaskResult format

export interface TaskRunnerOptions {
  model?: LanguageModel;
  logToolCalls?: boolean;
  captureToolCalls?: boolean; // New option to capture tool calls for scoring
}

export function TaskRunner(options: TaskRunnerOptions | LanguageModel = {}) {
  // Handle legacy API where model was passed directly
  const isLegacyModel = typeof options === "object" && "modelId" in options;
  const {
    model = defaultModel,
    logToolCalls = true,
    captureToolCalls = true, // Now defaults to true
  } = isLegacyModel
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
          if (event.toolCalls && event.toolCalls.length > 0) {
            for (const call of event.toolCalls) {
              if (logToolCalls) {
                console.log(`\n🔧 Tool called: ${call.toolName}`);
                console.log(`   Args: ${JSON.stringify(call.args, null, 2)}`);
              }
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

      // Return TaskResult format for vitest-evals 0.4.0
      if (captureToolCalls) {
        return {
          result: text,
          toolCalls: toolCalls.map((tc) => ({
            name: tc.toolName,
            arguments: tc.args,
          })),
        };
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
 * A simple task runner that doesn't execute tools, just passes the input through
 * for use with ToolPredictionScorer
 */
export function SimpleTaskRunner() {
  return async function SimpleTaskRunner(input: string) {
    // Just return the input as the result, no tool execution
    return {
      result: input,
      toolCalls: [],
    };
  };
}

// No longer needed - tool calls are returned in TaskResult format

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

// ToolCallScorer is now provided by vitest-evals 0.4.0

/**
 * A scorer that uses AI to predict what tools would be called without executing them.
 * This is much faster than actually running the tools and checking what was called.
 */
export function ToolPredictionScorer(model: LanguageModel = defaultModel) {
  // List of available Sentry MCP tools for context
  const AVAILABLE_TOOLS = [
    "find_organizations - List organizations the user has access to",
    "find_teams - List teams in an organization",
    "find_projects - List projects in an organization",
    "find_issues - Search for grouped error issues in Sentry",
    "find_releases - List releases/versions for a project",
    "find_tags - List available tags for filtering in an organization",
    "find_dsns - Get DSN configuration for a project",
    "search_events - Search individual error events, logs, or traces using natural language",
    "get_issue_details - Get detailed information about a specific issue including stacktrace",
    "update_issue - Update issue status (resolve/ignore) or assignment",
    "create_project - Create a new project in Sentry",
    "create_team - Create a new team in an organization",
    "create_dsn - Create an additional DSN for an existing project",
    "update_project - Update project settings like name or platform",
    "analyze_issue_with_seer - Get AI-powered root cause analysis for an issue",
    "search_docs - Search Sentry documentation for any topic (setup, features, concepts, rate limiting, etc.)",
    "get_doc - Retrieve full documentation content from a specific path",
    "whoami - Get authenticated user info",
  ];

  return async function ToolPredictionScorer(opts: {
    input: string;
    output: string;
    expected?: any;
    result?: any;
  }) {
    const expectedTools = opts.expected || [];

    // Generate a description of the expected tools for the prompt
    const expectedDescription = expectedTools
      .map(
        (tool: any) =>
          `- ${tool.name} with arguments: ${JSON.stringify(tool.arguments)}`,
      )
      .join("\n");

    const { object } = await generateObject({
      model,
      prompt: `You are evaluating whether an AI assistant with access to Sentry MCP tools would make the correct tool calls for a given task.

[AVAILABLE TOOLS]
${AVAILABLE_TOOLS.join("\n")}

[TASK]
${opts.input}

[EXPECTED TOOL CALLS]
${expectedDescription}

Based on the task and available tools, predict what tools the AI would call to complete this task.

IMPORTANT: Look at what information is already provided in the task:
- If organizationSlug and projectSlug are explicitly given, the AI may NOT need discovery calls
- If only organization/project names are given vaguely, discovery calls ARE needed
- The expected tool calls show what is ACTUALLY expected for this specific case

Consider:
1. Match the expected tool sequence - if it's just create_dsn, the AI should call ONLY create_dsn
2. Arguments should match expected values (organizationSlug, projectSlug, name, etc.)
3. For natural language queries in search_events, exact phrasing doesn't need to match
4. Extra parameters like regionUrl are acceptable
5. Discovery calls (find_organizations, find_projects) are only needed if information is missing

Score as follows:
- 1.0: All expected tools would be called with correct arguments in the right order
- 0.8: All expected tools would be called, minor differences (extra params, slight variations)
- 0.6: Most expected tools would be called but missing some or wrong order
- 0.3: Some expected tools would be called but significant issues
- 0.0: Wrong tools or critical tools missing`,
      schema: z.object({
        score: z.number().min(0).max(1).describe("Score from 0 to 1"),
        rationale: z.string().describe("Explanation of the score"),
        predictedTools: z
          .array(
            z.object({
              name: z.string(),
              arguments: z.record(z.any()).optional().default({}),
            }),
          )
          .describe("What tools the AI would likely call"),
      }),
    });

    return {
      score: object.score,
      metadata: {
        rationale: object.rationale,
        predictedTools: object.predictedTools,
        expectedTools: expectedTools,
      },
    };
  };
}

/**
 * Helper function to identify related tools for partial credit
 */
function getRelatedTools(tool: string): string[] {
  const relationships: Record<string, string[]> = {
    find_issues: ["get_issue_details", "search_events"],
    get_issue_details: ["find_issues", "analyze_issue_with_seer"],
    search_events: ["find_issues", "find_errors", "find_transactions"],
    find_errors: ["search_events", "find_issues"],
    find_transactions: ["search_events"],
    create_project: ["find_projects", "update_project"],
    update_project: ["find_projects", "create_project"],
    create_team: ["find_teams"],
    create_dsn: ["find_dsns"],
    find_organizations: ["find_teams", "find_projects"],
    find_teams: ["find_organizations", "find_projects"],
    find_projects: ["find_organizations", "find_teams"],
  };

  return relationships[tool] || [];
}

/**
 * Custom scorer for search_events that's flexible with natural language queries
 * and other common parameter variations
 */
export function SearchEventsScorer() {
  return async function SearchEventsScorer(opts: {
    input: string;
    output: string;
    expected?: any;
    result?: any;
  }) {
    // For vitest-evals, expected should be the expectedTools array from our test data
    const expectedTools = opts.expected || [];
    const actualToolCalls = opts.result?.toolCalls || [];

    // Find all search_events calls
    const expectedSearchEvents = expectedTools.filter(
      (t: any) => t.name === "search_events",
    );
    const actualSearchEvents = actualToolCalls.filter(
      (t: any) => t.name === "search_events",
    );

    // Score each expected search_events call
    let totalScore = 0;
    let scoredCount = 0;

    for (const expected of expectedSearchEvents) {
      scoredCount++;
      let bestScore = 0;

      for (const actual of actualSearchEvents) {
        let score = 0;
        let matches = 0;
        let totalChecks = 0;

        // Check organizationSlug (required, must match exactly)
        totalChecks++;
        if (
          actual.arguments.organizationSlug ===
          expected.arguments.organizationSlug
        ) {
          matches++;
          score += 0.3; // 30% for correct org
        }

        // Check dataset (important, must match exactly)
        totalChecks++;
        if (actual.arguments.dataset === expected.arguments.dataset) {
          matches++;
          score += 0.3; // 30% for correct dataset
        }

        // Check naturalLanguageQuery (flexible - just needs to exist)
        if (expected.arguments.naturalLanguageQuery) {
          totalChecks++;
          if (actual.arguments.naturalLanguageQuery) {
            matches++;
            score += 0.2; // 20% for having a query
            // No need to match exact text since it's natural language
          }
        }

        // Check projectSlug (optional)
        if (expected.arguments.projectSlug) {
          totalChecks++;
          if (actual.arguments.projectSlug === expected.arguments.projectSlug) {
            matches++;
            score += 0.1; // 10% for correct project
          }
        }

        // Allow extra parameters like regionUrl, limit, etc. (10% bonus)
        const hasExtraParams = Object.keys(actual.arguments).some(
          (key) =>
            ![
              "organizationSlug",
              "dataset",
              "naturalLanguageQuery",
              "projectSlug",
            ].includes(key),
        );
        if (hasExtraParams) {
          score += 0.1; // 10% bonus for helpful extra params
        }

        bestScore = Math.max(bestScore, Math.min(1, score));
      }

      totalScore += bestScore;
    }

    // Handle other tool calls (not search_events)
    const otherExpectedTools = expectedTools.filter(
      (t: any) => t.name !== "search_events",
    );
    const otherActualTools = actualToolCalls.filter(
      (t: any) => t.name !== "search_events",
    );

    // Use standard scoring for other tools
    for (const expected of otherExpectedTools) {
      scoredCount++;
      let bestScore = 0;

      for (const actual of otherActualTools) {
        if (actual.name === expected.name) {
          // Simple argument matching for non-search_events tools
          const expectedKeys = Object.keys(expected.arguments);
          const actualKeys = Object.keys(actual.arguments);

          let matches = 0;
          for (const key of expectedKeys) {
            if (
              key in actual.arguments &&
              JSON.stringify(actual.arguments[key]) ===
                JSON.stringify(expected.arguments[key])
            ) {
              matches++;
            }
          }

          const score = matches / expectedKeys.length;
          bestScore = Math.max(bestScore, score);
        }
      }

      totalScore += bestScore;
    }

    const finalScore = scoredCount > 0 ? totalScore / scoredCount : 0;

    return {
      score: finalScore,
      metadata: {
        rationale: `Matched ${Math.round(finalScore * 100)}% of expected tool calls (search_events uses flexible natural language matching)`,
        expectedTools: expectedTools.map((t: any) => t.name),
        actualTools: actualToolCalls.map((t: any) => t.name),
      },
    };
  };
}
