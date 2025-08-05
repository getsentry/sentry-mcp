import { z } from "zod";
import { ConfigurationError } from "../../errors";
import { callEmbeddedAgent } from "../../internal/agents/callEmbeddedAgent";
import type { SentryApiService } from "../../api-client";
import { createOtelLookupTool } from "../../internal/agents/tools/otel-semantics";
import { createWhoamiTool } from "../../internal/agents/tools/whoami";
import { createDatasetAttributesTool } from "./utils";
import { systemPrompt } from "./config";

const outputSchema = z
  .object({
    dataset: z
      .enum(["spans", "errors", "logs"])
      .describe("Which dataset to use for the query"),
    query: z
      .string()
      .default("")
      .nullish()
      .describe("The Sentry query string for filtering results"),
    fields: z
      .array(z.string())
      .describe("Array of field names to return in results."),
    sort: z.string().describe("Sort parameter for results."),
    timeRange: z
      .union([
        z.object({
          statsPeriod: z
            .string()
            .describe("Relative time period like '1h', '24h', '7d'"),
        }),
        z.object({
          start: z.string().describe("ISO 8601 start time"),
          end: z.string().describe("ISO 8601 end time"),
        }),
      ])
      .nullish()
      .describe(
        "Time range for filtering events. Use either statsPeriod for relative time or start/end for absolute time.",
      ),
    explanation: z
      .string()
      .describe("Brief explanation of how you translated this query."),
  })
  .refine(
    (data) => {
      // Only validate if both sort and fields are present
      if (!data.sort || !data.fields || data.fields.length === 0) {
        return true;
      }

      // Extract the field name from sort parameter (e.g., "-timestamp" -> "timestamp", "-count()" -> "count()")
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

/**
 * Search events agent - single entry point for translating natural language queries to Sentry search syntax
 * This returns both the translated query result AND the tool calls made by the agent
 */
export async function searchEventsAgent(
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

  const datasetAttributesTool = createDatasetAttributesTool(
    apiService,
    organizationSlug,
    projectId,
  );
  const otelLookupTool = createOtelLookupTool(
    apiService,
    organizationSlug,
    projectId,
  );
  const whoamiTool = createWhoamiTool(apiService);

  // Use callEmbeddedAgent to translate the query with tool call capture
  return await callEmbeddedAgent({
    system: systemPrompt,
    prompt: query,
    tools: {
      datasetAttributes: datasetAttributesTool,
      otelSemantics: otelLookupTool,
      whoami: whoamiTool,
    },
    schema: outputSchema,
  });
}
