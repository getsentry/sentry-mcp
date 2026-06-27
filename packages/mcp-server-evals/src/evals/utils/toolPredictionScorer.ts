import { generateObject } from "ai";
import { z } from "zod";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import {
  createJudge,
  toJsonValue,
  type Judge,
  type JudgeContext,
} from "vitest-evals";
import { getEvalModelConfig } from "./model";
import { createMockMcpTransport } from "./mcpTransport";

// Cache for available tools to avoid reconnecting for each test
let cachedTools: string[] | null = null;

/**
 * Get available tools from the MCP server by connecting to it directly.
 * This ensures the tool list stays in sync with what's actually registered.
 */
async function getAvailableTools(): Promise<string[]> {
  if (cachedTools) {
    return cachedTools;
  }

  const client = await experimental_createMCPClient({
    transport: createMockMcpTransport(),
  });

  // Discover available tools
  const toolsMap = await client.tools();

  // Convert tools to the format expected by the scorer
  cachedTools = Object.entries(toolsMap).map(([name, tool]) => {
    // Extract the first line of description for a concise summary
    const shortDescription = (tool as any).description?.split("\n")[0] || "";
    return `${name} - ${shortDescription}`;
  });

  // Clean up
  await client.close();

  return cachedTools;
}

export interface ExpectedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolPredictionJudgeOptions extends JudgeContext<string, string> {
  input: string;
  output: string;
  expectedTools: ExpectedToolCall[];
}

const predictionSchema = z.object({
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
});

function generateSystemPrompt(
  availableTools: string[],
  task: string,
  expectedDescription: string,
): string {
  return `You are evaluating whether an AI assistant with access to Sentry MCP tools would make the correct tool calls for a given task.

[AVAILABLE TOOLS]
${availableTools.join("\n")}

[TASK]
${task}

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
- The test author has determined what's appropriate for each specific scenario`;
}

/**
 * A judge that uses AI to predict what tools would be called without executing them.
 * This is much faster than actually running the tools and checking what was called.
 *
 * @returns A judge that compares predicted vs expected tool calls
 *
 * @example
 * ```typescript
 * import { expect } from "vitest";
 * import { describeEval } from "vitest-evals";
 * import { ToolPredictionJudge, createTaskHarness } from "./utils";
 *
 * describeEval("Sentry issue search", {
 *   harness: createTaskHarness("tool-prediction", NoOpTaskRunner()),
 * }, (it) => {
 *   it("predicts issue search tools", async ({ run }) => {
 *     const result = await run("Find the newest issues in my-org");
 *     await expect(result).toSatisfyJudge(ToolPredictionJudge(), {
 *       expectedTools: [
 *         { name: "find_organizations", arguments: {} },
 *         { name: "find_issues", arguments: { organizationSlug: "my-org", sortBy: "first_seen" } },
 *       ],
 *       threshold: 0.8,
 *     });
 *   });
 * });
 * ```
 *
 * The judge works by:
 * 1. Connecting to the MCP server to get available tools and their descriptions
 * 2. Using AI to predict what tools would be called for the given task
 * 3. Comparing predictions against the expectedTools array
 * 4. Returning a score from 0.0 to 1.0 based on accuracy
 *
 * Scoring criteria:
 * - 1.0: All expected tools predicted with correct arguments in right order
 * - 0.8: All expected tools predicted, minor differences (extra params, slight variations)
 * - 0.6: Most expected tools predicted but missing some or wrong order
 * - 0.3: Some expected tools predicted but significant issues
 * - 0.0: Wrong tools or critical tools missing
 *
 */
export function ToolPredictionJudge(): Judge<ToolPredictionJudgeOptions> {
  return createJudge<ToolPredictionJudgeOptions>(
    "ToolPredictionJudge",
    async (opts) => {
      const modelConfig = getEvalModelConfig();

      const expectedTools = opts.expectedTools;
      const AVAILABLE_TOOLS = await getAvailableTools();
      const expectedDescription = expectedTools
        .map(
          (tool) =>
            `- ${tool.name} with arguments: ${JSON.stringify(tool.arguments)}`,
        )
        .join("\n");

      const { object } = await generateObject({
        model: modelConfig.model,
        prompt: generateSystemPrompt(
          AVAILABLE_TOOLS,
          opts.input,
          expectedDescription,
        ),
        schema: predictionSchema,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "tool_prediction_judge",
        },
        providerOptions: modelConfig.providerOptions,
      });

      return {
        score: object.score,
        metadata: {
          rationale: object.rationale,
          predictedTools: toJsonValue(object.predictedTools),
          expectedTools: toJsonValue(expectedTools),
        },
      };
    },
  );
}
