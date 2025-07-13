import { openai } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
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
- When only an organization name is given (e.g., "in sentry-mcp-evals"), discovery calls ARE typically needed
- When organization/project are given in "org/project" format, the AI may skip discovery if confident
- The expected tool calls show what is ACTUALLY expected for this specific case - follow them exactly
- Discovery calls (find_organizations, find_projects) are commonly used to get regionUrl and verify access
- Match the expected tool sequence exactly - if expected includes discovery, predict discovery

Consider:
1. Match the expected tool sequence exactly - the expected tools show realistic AI behavior
2. When a value like "sentry-mcp-evals" appears alone, it's typically an organizationSlug, not a projectSlug
3. Arguments should match expected values (organizationSlug, projectSlug, name, etc.)
4. For natural language queries in search_events, exact phrasing doesn't need to match
5. Extra parameters like regionUrl are acceptable
6. The AI commonly does discovery calls even when slugs appear to be provided, to get region info

Score as follows:
- 1.0: All expected tools would be called with correct arguments in the right order
- 0.8: All expected tools would be called, minor differences (extra params, slight variations)
- 0.6: Most expected tools would be called but missing some or wrong order
- 0.3: Some expected tools would be called but significant issues
- 0.0: Wrong tools or critical tools missing

CRITICAL: The expected tools represent the actual realistic behavior for this specific case. Follow the expected sequence exactly:
- If expected tools include discovery calls, predict discovery calls
- If expected tools do NOT include discovery calls, do NOT predict them
- The test author has determined what's appropriate for each specific scenario`,
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
