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
    .optional()
    .describe("How to sort the results"),
  explanation: z
    .string()
    .optional()
    .describe("Brief explanation of the translation"),
});

export type IssueQuery = z.infer<typeof IssueQuerySchema>;

/**
 * Translate natural language query to Sentry issue search syntax
 */
export async function translateQuery(
  params: {
    naturalLanguageQuery: string;
    organizationSlug: string;
    projectSlug?: string;
  },
  apiService: SentryApiService,
  previousError?: string,
): Promise<IssueQuery> {
  // Get OpenAI API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConfigurationError(
      "OpenAI API key not configured. Set OPENAI_API_KEY environment variable.",
    );
  }

  // Create whoami tool for 'me' references
  const whoamiTool = createWhoamiTool(apiService);

  // Create the agent tools
  const tools = {
    issueFields: createDatasetFieldsTool(
      apiService,
      params.organizationSlug,
      "search_issues",
      params.projectSlug,
    ),
    whoami: whoamiTool,
  };

  try {
    // Build the prompt with error feedback if provided
    let prompt = params.naturalLanguageQuery;
    if (previousError) {
      prompt = `${params.naturalLanguageQuery}\n\nPrevious attempt failed with: ${previousError}\nPlease correct the query.`;
    }

    const result = await generateText({
      model: openai("gpt-4o", { structuredOutputs: true }),
      system: systemPrompt,
      prompt,
      tools,
      maxSteps: 3,
      experimental_output: Output.object({
        schema: IssueQuerySchema,
      }),
    });

    const query = result.experimental_output;
    if (!query) {
      throw new Error("Failed to generate query");
    }

    // Validate the query doesn't have SQL-like syntax
    if (query.query.includes("SELECT") || query.query.includes("FROM")) {
      throw new UserInputError(
        "Generated SQL-like syntax instead of Sentry query syntax. Please try rephrasing your query.",
      );
    }

    return query;
  } catch (error) {
    if (
      error instanceof UserInputError ||
      error instanceof ConfigurationError
    ) {
      throw error;
    }

    // Handle OpenAI API errors
    if (error instanceof Error && error.message.includes("API key")) {
      throw new ConfigurationError(
        "OpenAI API key is invalid or not configured properly.",
      );
    }

    throw new Error(
      `Failed to translate query: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
