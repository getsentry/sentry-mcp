import { z } from "zod";
import { ConfigurationError } from "../../errors";
import { callEmbeddedAgent } from "../../internal/agents/callEmbeddedAgent";
import type { SentryApiService } from "../../api-client";
import { createWhoamiTool } from "../../internal/agents/tools/whoami";
import { createIssueEventFieldsTool } from "./utils";
import { systemPrompt } from "./config";

// OpenAI structured outputs (used by GPT-5) require all properties to be in the 'required' array.
// Avoid .optional()/.default() so the generated JSON Schema keeps every field required.
// Tracking: https://github.com/getsentry/sentry-mcp/issues/623
export const searchIssueEventsAgentOutputSchema = z
  .object({
    query: z
      .string()
      .describe(
        "Sentry query filters for tags/fields (NOT including issue: prefix - handler adds that)",
      ),
    fields: z
      .array(z.string())
      .describe("Array of field names to return in results"),
    sort: z.string().describe("Sort parameter for results (e.g., -timestamp)"),
    timeRange: z
      .union([
        z.object({
          statsPeriod: z
            .string()
            .describe("Relative time period like '1h', '24h', '7d', '14d'"),
        }),
        z.object({
          start: z.string().describe("ISO 8601 start time"),
          end: z.string().describe("ISO 8601 end time"),
        }),
        z.null(),
      ])
      .describe(
        "Time range for filtering events. Use either statsPeriod for relative time or start/end for absolute time. Use null for default 14-day window.",
      ),
    explanation: z
      .string()
      .describe("Brief explanation of how you translated this query"),
  })
  .refine(
    (data) => {
      // Only validate if both sort and fields are present
      if (!data.sort || !data.fields || data.fields.length === 0) {
        return true;
      }

      // Extract the field name from sort parameter (e.g., "-timestamp" -> "timestamp")
      const sortField = data.sort.startsWith("-")
        ? data.sort.substring(1)
        : data.sort;

      // Check if sort field is in fields array
      return data.fields.includes(sortField);
    },
    {
      message:
        "Sort field must be included in the fields array. Sentry requires that any field used for sorting must also be explicitly selected. Add the sort field to the fields array or choose a different sort field that's already included.",
    },
  );

export interface SearchIssueEventsAgentOptions {
  query: string;
  organizationSlug: string;
  apiService: SentryApiService;
  projectId?: string;
}

/**
 * Search issue events agent - translates natural language queries to Sentry tag filters for events within a specific issue
 * Returns both the translated query result AND the tool calls made by the agent
 */
export async function searchIssueEventsAgent(
  options: SearchIssueEventsAgentOptions,
): Promise<{
  result: z.output<typeof searchIssueEventsAgentOutputSchema>;
  toolCalls: any[];
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ConfigurationError(
      "OPENAI_API_KEY environment variable is required for natural language query translation",
    );
  }

  // Create tools pre-bound with the provided API service and organization
  const issueEventFieldsTool = createIssueEventFieldsTool({
    apiService: options.apiService,
    organizationSlug: options.organizationSlug,
    projectId: options.projectId,
  });

  const whoamiTool = createWhoamiTool({
    apiService: options.apiService,
  });

  // Use callEmbeddedAgent to translate the query with tool call capture
  return await callEmbeddedAgent<
    z.output<typeof searchIssueEventsAgentOutputSchema>,
    typeof searchIssueEventsAgentOutputSchema
  >({
    system: systemPrompt,
    prompt: options.query,
    tools: {
      issueEventFields: issueEventFieldsTool,
      whoami: whoamiTool,
    },
    schema: searchIssueEventsAgentOutputSchema,
  });
}
