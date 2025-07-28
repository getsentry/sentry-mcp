import { z } from "zod";
import type { SentryApiService } from "../../api-client";
import { ConfigurationError, UserInputError } from "../../errors";
import { callEmbeddedAgent } from "../../internal/agents/callEmbeddedAgent";
import { createDatasetFieldsTool } from "../../internal/agents/tools/dataset-fields";
import { createWhoamiTool } from "../../internal/agents/tools/whoami";
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

/**
 * Search issues agent - single entry point for translating natural language queries to Sentry issue search syntax
 * This returns both the translated query result AND the tool calls made by the agent
 */
export async function searchIssuesAgent(
  query: string,
  organizationSlug: string,
  apiService: SentryApiService,
  projectId?: string,
): Promise<{
  result: IssueQuery;
  toolCalls: any[]; // CoreToolCall<any, any>[]
}> {
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

  try {
    const agentResult = await callEmbeddedAgent({
      system: systemPrompt,
      prompt: query,
      tools,
      schema: IssueQuerySchema,
    });

    // Return both the result and tool calls
    return {
      result: agentResult.result,
      toolCalls: agentResult.toolCalls,
    };
  } catch (error) {
    if (
      error instanceof UserInputError ||
      error instanceof ConfigurationError
    ) {
      throw error;
    }

    throw new Error(
      `Failed to translate query: ${error instanceof Error ? error.message : "Unknown error"}`,
      { cause: error },
    );
  }
}
