/**
 * Testable version of the search issues agent that exposes tool calls
 * This is used for evaluation and testing purposes only
 */
import { z } from "zod";
import type { SentryApiService } from "../../api-client";
import type { CoreToolCall } from "ai";
import { ConfigurationError } from "../../errors";
import { callEmbeddedAgent } from "../../internal/agents/callEmbeddedAgent";
import { createDatasetFieldsTool } from "../../agent-tools/discover-dataset-fields";
import { createWhoamiTool } from "../../agent-tools/whoami";
import { systemPrompt } from "./config";

// Schema for agent output
const IssueQuerySchema = z.object({
  query: z.string().describe("The Sentry issue search query"),
  sort: z
    .enum(["date", "freq", "new", "user"])
    .nullable()
    .describe("How to sort the results (null if no specific sort is needed)"),
  explanation: z
    .string()
    .nullable()
    .describe("Brief explanation of the translation (null if not needed)"),
});

export type IssueQuery = z.infer<typeof IssueQuerySchema>;

export interface TestableAgentResult {
  result: IssueQuery;
  toolCalls: CoreToolCall<any, any>[];
}

/**
 * Testable version of the search issues agent
 */
export async function testableSearchIssuesAgent(
  query: string,
  organizationSlug: string,
  apiService: SentryApiService,
  projectId?: string,
): Promise<TestableAgentResult> {
  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    throw new ConfigurationError(
      "OpenAI API key not configured. Set OPENAI_API_KEY environment variable.",
    );
  }

  // Create the agent tools
  const tools = {
    issueFields: createDatasetFieldsTool(
      apiService,
      organizationSlug,
      "search_issues",
      projectId,
    ),
    whoami: createWhoamiTool(apiService),
  };

  // Use callEmbeddedAgent to get both result and tool calls
  const agentResult = await callEmbeddedAgent({
    system: systemPrompt,
    prompt: query,
    tools,
    schema: IssueQuerySchema,
  });

  return agentResult;
}
