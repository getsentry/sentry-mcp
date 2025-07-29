import { z } from "zod";
import type { SentryApiService } from "../../api-client";
import { ConfigurationError } from "../../errors";
import { callEmbeddedAgent } from "../../internal/agents/callEmbeddedAgent";
import { createDatasetFieldsTool } from "../../internal/agents/tools/dataset-fields";
import { createWhoamiTool } from "../../internal/agents/tools/whoami";
import { systemPrompt } from "./config";

const outputSchema = z.object({
  query: z
    .string()
    .default("")
    .nullish()
    .describe("The Sentry issue search query"),
  sort: z
    .enum(["date", "freq", "new", "user"])
    .default("date")
    .nullish()
    .describe("How to sort the results"),
  explanation: z
    .string()
    .describe("Brief explanation of how you translated this query."),
});

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
  result: z.infer<typeof outputSchema>;
  toolCalls: any[];
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ConfigurationError(
      "OPENAI_API_KEY environment variable is required for semantic search",
    );
  }

  return await callEmbeddedAgent({
    system: systemPrompt,
    prompt: query,
    tools: {
      issueFields: createDatasetFieldsTool(
        apiService,
        organizationSlug,
        "search_issues",
        projectId,
      ),
      whoami: createWhoamiTool(apiService),
    },
    schema: outputSchema,
  });
}
