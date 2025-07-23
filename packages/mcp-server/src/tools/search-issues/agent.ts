import { generateText, tool, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { SentryApiService } from "../../api-client";
import { ConfigurationError, UserInputError } from "../../errors";
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

/**
 * Translate natural language query to Sentry issue search syntax
 */
export async function translateQuery(
  params: {
    naturalLanguageQuery: string;
    organizationSlug: string;
    projectSlugOrId?: string;
    projectId?: string;
  },
  apiService: SentryApiService,
): Promise<IssueQuery> {
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
      params.organizationSlug,
      "search_issues",
      params.projectId,
    ),
    whoami: createWhoamiTool(apiService),
  };

  try {
    const result = await generateText({
      model: openai("gpt-4o", { structuredOutputs: true }),
      system: systemPrompt,
      prompt: params.naturalLanguageQuery,
      tools,
      maxSteps: 3,
      experimental_output: Output.object({
        schema: IssueQuerySchema,
      }),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "search_issues_agent",
      },
    });

    const query = result.experimental_output;
    if (!query) {
      throw new Error("Failed to generate query");
    }

    return query;
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
