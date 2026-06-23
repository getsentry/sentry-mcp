import { z } from "zod";
import { callEmbeddedAgent } from "../../../internal/agents/callEmbeddedAgent";
import type { SentryApiService } from "../../../api-client";
import { createOtelLookupTool } from "../../../internal/agents/tools/otel-semantics";
import { createDatasetFieldsTool } from "../../../internal/agents/tools/dataset-fields";
import { createWhoamiTool } from "../../../internal/agents/tools/whoami";
import { logWarn } from "../../../telem/logging";
import type { PublicEventsDataset } from "../../../utils/events-datasets";
import { PUBLIC_EVENTS_DATASETS } from "../../../utils/events-datasets";
import {
  buildPrefetchedFieldCatalog,
  createDatasetAttributesTool,
} from "./utils";
import { systemPrompt } from "./config";

const SEARCH_EVENTS_DATASETS = [...PUBLIC_EVENTS_DATASETS, "replays"] as const;

// .default("") on explanation is safe because structuredOutputs: false is set via providerOptions.
// If structuredOutputs is re-enabled, remove .default() calls (OpenAI requires all fields in 'required').
// Tracking: https://github.com/getsentry/sentry-mcp/issues/623
export const searchEventsAgentOutputSchema = z
  .object({
    dataset: z
      .enum(SEARCH_EVENTS_DATASETS)
      .describe("Which dataset to use for the query"),
    query: z.string().describe("The Sentry query string for filtering results"),
    fields: z
      .array(z.string())
      .describe("Array of field names to return in results."),
    sort: z.string().describe("Sort parameter for results."),
    environment: z
      .union([z.string(), z.array(z.string()).min(1)])
      .nullable()
      .default(null)
      .describe(
        "Separate environment filter for datasets like replays that do not support environment in the query string. Use a string for one environment or an array when multiple environments are requested.",
      ),
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
        z.null(),
      ])
      .describe(
        "Time range for filtering events. Use either statsPeriod for relative time or start/end for absolute time.",
      ),
    explanation: z
      .string()
      .default("")
      .describe("Brief explanation of how you translated this query."),
  })
  .refine(
    (data) => {
      if (data.dataset === "replays") {
        return true;
      }

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

export interface SearchEventsAgentOptions {
  query: string;
  organizationSlug: string;
  apiService: SentryApiService;
  projectId?: string;
  dataset?: PublicEventsDataset | "replays";
  statsPeriod?: string;
  start?: string;
  end?: string;
}

async function buildSearchEventsAgentPrompt(
  options: SearchEventsAgentOptions,
): Promise<string> {
  const sections: string[] = [];

  if (options.dataset) {
    try {
      const fieldCatalog = await buildPrefetchedFieldCatalog({
        apiService: options.apiService,
        organizationSlug: options.organizationSlug,
        dataset: options.dataset,
        projectId: options.projectId,
        statsPeriod: options.statsPeriod,
        start: options.start,
        end: options.end,
      });

      sections.push(
        `Prefetched field catalog for dataset "${options.dataset}":`,
        "Construct the query using these discovered fields.",
        "Call datasetAttributes or replayFields only for targeted substringMatch/query lookups, or if you choose a different dataset.",
        "",
        fieldCatalog,
      );
    } catch (error) {
      logWarn(error, {
        loggerScope: ["search-events", "prefetch-fields"],
        extra: {
          dataset: options.dataset,
          organizationSlug: options.organizationSlug,
        },
      });
    }
  }

  sections.push("---", "", options.query);
  return sections.join("\n");
}

/**
 * Search events agent - single entry point for translating natural language queries to Sentry search syntax
 * This returns both the translated query result AND the tool calls made by the agent
 */
export async function searchEventsAgent(
  options: SearchEventsAgentOptions,
): Promise<{
  result: z.output<typeof searchEventsAgentOutputSchema>;
  toolCalls: any[];
}> {
  // Provider check happens in callEmbeddedAgent via getAgentProvider()
  // Create tools pre-bound with the provided API service and organization
  const datasetAttributesTool = createDatasetAttributesTool({
    apiService: options.apiService,
    organizationSlug: options.organizationSlug,
    projectId: options.projectId,
  });
  const otelLookupTool = createOtelLookupTool({
    apiService: options.apiService,
    organizationSlug: options.organizationSlug,
    projectId: options.projectId,
  });
  const replayFieldsTool = createDatasetFieldsTool({
    apiService: options.apiService,
    organizationSlug: options.organizationSlug,
    dataset: "replays",
    projectId: options.projectId,
  });
  const whoamiTool = createWhoamiTool({ apiService: options.apiService });
  const prompt = await buildSearchEventsAgentPrompt(options);

  // Use callEmbeddedAgent to translate the query with tool call capture
  return await callEmbeddedAgent<
    z.output<typeof searchEventsAgentOutputSchema>,
    typeof searchEventsAgentOutputSchema
  >({
    system: systemPrompt,
    prompt,
    tools: {
      datasetAttributes: datasetAttributesTool,
      replayFields: replayFieldsTool,
      otelSemantics: otelLookupTool,
      whoami: whoamiTool,
    },
    schema: searchEventsAgentOutputSchema,
  });
}
