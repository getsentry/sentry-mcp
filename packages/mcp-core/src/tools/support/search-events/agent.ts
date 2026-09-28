import { z } from "zod";
import type { SentryApiService } from "../../../api-client";
import {
  callEmbeddedAgent,
  type ToolCall,
} from "../../../internal/agents/callEmbeddedAgent";
import { createDatasetFieldsTool } from "../../../internal/agents/tools/dataset-fields";
import { createOtelLookupTool } from "../../../internal/agents/tools/otel-semantics";
import { createWhoamiTool } from "../../../internal/agents/tools/whoami";
import { PUBLIC_EVENTS_DATASETS } from "../../../utils/events-datasets";
import { systemPrompt } from "./config";
import {
  createDatasetAttributesTool,
  createValidateEventsSearchTool,
} from "./utils";

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
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .nullable()
      .default(null)
      .describe(
        "Separate environment filter for datasets like replays that do not support environment in the query string. Set only to a real environment the user named (see the 'Available environments' list); omit otherwise. Never use wildcards, placeholders, or example values.",
      ),
    timeSeries: z
      .object({
        yAxis: z
          .string()
          .describe(
            "The aggregate to plot over time, e.g. 'count()', 'count_unique(user)', 'sum(span.duration)'.",
          ),
        interval: z
          .string()
          .nullable()
          .default(null)
          .describe(
            "Bucket size like '1h' or '1d'. Set ONLY when the user names a granularity (e.g. 'per hour' -> '1h'); otherwise null so Sentry picks a sensible bucket for the time range.",
          ),
      })
      .nullable()
      .default(null)
      .describe(
        "Set ONLY when the user wants a metric OVER TIME (e.g. 'per hour', 'per day', 'trend', 'over time'). Otherwise leave null and return a normal query. The interval is decided here, never required from the caller.",
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

      // Timeseries requests use yAxis/interval, not sort-in-fields.
      if (data.timeSeries) {
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
  /**
   * The org's real environment names, used to ground the prompt. When omitted
   * the agent fetches them itself; the search_events tool passes a pre-fetched
   * list so the same call is reused for post-agent validation.
   */
  environmentNames?: string[];
}

// Above this many environments we stop inlining the full list into the prompt
// (token cost) and rely on the guidance text alone; validation still checks the
// value against the real list.
const MAX_INLINE_ENVIRONMENTS = 100;

/**
 * Append the organization's real environment names to the system prompt.
 *
 * Without this the model invents `environment` values (e.g. `":null"`, `".*"`)
 * that Sentry rejects, burning the step budget and producing no output — the top
 * source of search_events failures. Grounding it lets the model pick a real one
 * or omit the field.
 */
export function buildSystemPromptWithEnvironments(
  base: string,
  environmentNames: string[],
): string {
  if (environmentNames.length === 0) {
    return base;
  }
  const rule =
    'When the user names an environment, set the `environment` field to a matching value from this list EXACTLY; otherwise OMIT the field. Never use wildcards, placeholders, "null", "*", empty strings, or example values.';
  if (environmentNames.length <= MAX_INLINE_ENVIRONMENTS) {
    const list = environmentNames.map((name) => `"${name}"`).join(", ");
    return `${base}\n\n## Available environments\nThe only valid \`environment\` values for this organization are: ${list}.\n${rule}`;
  }
  return `${base}\n\n## Environments\nThis organization has ${environmentNames.length} environments. ${rule}`;
}

/**
 * Best-effort fetch of the org's environment names (scoped to the project when
 * known). Failures are non-fatal — callers still run, just without grounding.
 */
export async function fetchEnvironmentNames(options: {
  apiService: SentryApiService;
  organizationSlug: string;
  projectId?: string;
}): Promise<string[]> {
  try {
    const environments = await options.apiService.listEnvironments({
      organizationSlug: options.organizationSlug,
      projectId: options.projectId,
    });
    return environments
      .map((environment) => environment.name)
      .filter((name) => name.length > 0);
  } catch {
    return [];
  }
}

/**
 * Search events agent - single entry point for translating natural language queries to Sentry search syntax
 * This returns both the translated query result AND the tool calls made by the agent
 */
export async function searchEventsAgent(
  options: SearchEventsAgentOptions,
): Promise<{
  result: z.output<typeof searchEventsAgentOutputSchema>;
  toolCalls: ToolCall[];
}> {
  // Provider check happens in callEmbeddedAgent via getAgentProvider()
  // Create tools pre-bound with the provided API service and organization
  const datasetAttributesTool = createDatasetAttributesTool({
    apiService: options.apiService,
    organizationSlug: options.organizationSlug,
    projectId: options.projectId,
  });
  const validateSearchTool = createValidateEventsSearchTool({
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

  // Ground the agent in the org's real environments so it stops inventing
  // invalid `environment` values (the top cause of no-output failures). The
  // tool passes a pre-fetched list; fall back to fetching for standalone callers.
  const environmentNames =
    options.environmentNames ?? (await fetchEnvironmentNames(options));

  // Use callEmbeddedAgent to translate the query with tool call capture
  return await callEmbeddedAgent<
    z.output<typeof searchEventsAgentOutputSchema>,
    typeof searchEventsAgentOutputSchema
  >({
    system: buildSystemPromptWithEnvironments(systemPrompt, environmentNames),
    prompt: options.query,
    tools: {
      datasetAttributes: datasetAttributesTool,
      validateSearch: validateSearchTool,
      replayFields: replayFieldsTool,
      otelSemantics: otelLookupTool,
      whoami: whoamiTool,
    },
    schema: searchEventsAgentOutputSchema,
  });
}
