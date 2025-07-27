import { z } from "zod";
import { ConfigurationError } from "../../errors";
import { callEmbeddedAgent } from "../../internal/agents/callEmbeddedAgent";
import type { SentryApiService } from "../../api-client";
import { createOtelLookupTool } from "../../agent-tools/lookup-otel-semantics";
import { createWhoamiTool } from "../../agent-tools/whoami";
import { createDatasetAttributesTool } from "./utils";

// Type definitions
export interface QueryTranslationResult {
  query?: string;
  fields?: string[];
  sort?: string;
  timeRange?:
    | {
        statsPeriod: string;
      }
    | {
        start: string;
        end: string;
      };
  error?: string;
}

export interface QueryTranslationParams {
  naturalLanguageQuery: string;
  dataset: "spans" | "errors" | "logs";
  organizationSlug: string;
  projectId?: string;
  allFields: Record<string, string>;
  datasetConfig: {
    rules: string;
    examples: string;
  };
  recommendedFields: {
    basic: string[];
    description: string;
  };
}

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
  result: QueryTranslationResult & { dataset?: "spans" | "errors" | "logs" };
  toolCalls: any[]; // CoreToolCall<any, any>[]
}> {
  // Check if OpenAI API key is available
  if (!process.env.OPENAI_API_KEY) {
    throw new ConfigurationError(
      "OPENAI_API_KEY environment variable is required for semantic search",
    );
  }

  // Build a dataset-agnostic system prompt
  const systemPrompt = `You are a Sentry query translator. You need to:
1. FIRST determine which dataset (spans, errors, or logs) is most appropriate for the query
2. Query the available attributes for that dataset using the datasetAttributes tool
3. Use the otelSemantics tool if you need OpenTelemetry semantic conventions
4. Convert the natural language query to Sentry's search syntax (NOT SQL syntax)
5. Decide which fields to return in the results

CRITICAL: Sentry does NOT use SQL syntax. Do NOT generate SQL-like queries.

DATASET SELECTION GUIDELINES:
- spans: Performance data, traces, AI/LLM calls, database queries, HTTP requests, token usage, costs, duration metrics, user agent data, "XYZ calls", ambiguous operations (richest attribute set)
- errors: Exceptions, crashes, error messages, stack traces, unhandled errors, browser/client errors
- logs: Log entries, log messages, severity levels, debugging information

For ambiguous queries like "calls using XYZ", prefer spans dataset first as it contains the most comprehensive telemetry data.

CRITICAL TOOL USAGE:
1. Use datasetAttributes tool to discover what fields are available for your chosen dataset
2. Use otelSemantics tool when you need specific OpenTelemetry attributes (gen_ai.*, db.*, http.*, etc.)
3. Use whoami tool when queries contain "me" references for user.id or user.email fields
4. IMPORTANT: For ambiguous terms like "user agents", "browser", "client" - ALWAYS use the datasetAttributes tool to find the correct field name (typically user_agent.original) instead of assuming it's related to user.id

CRITICAL - HANDLING "DISTINCT" OR "UNIQUE VALUES" QUERIES:
When user asks for "distinct", "unique", "all values of", or "what are the X" queries:
1. This ALWAYS requires an AGGREGATE query with count() function
2. Pattern: fields=['field_name', 'count()'] to show distinct values with counts
3. Sort by "-count()" to show most common values first
4. Use datasetAttributes tool to verify the field exists before constructing query
5. Examples:
   - "distinct tool names" → fields=['mcp.tool.name', 'count()'], sort='-count()'
   - "unique models" → fields=['gen_ai.request.model', 'count()'], sort='-count()'

CRITICAL - TRAFFIC/VOLUME/COUNT QUERIES:
When user asks about "traffic", "volume", "how much", "how many" (without specific metrics):
1. This ALWAYS requires an AGGREGATE query with count() function
2. For total counts: fields=['count()']
3. For grouped counts: fields=['grouping_field', 'count()']
4. Always include timeRange for period-specific queries
5. Examples:
   - "how much traffic in last 30 days" → fields=['count()'], timeRange: {"statsPeriod": "30d"}
   - "traffic on mcp-server" → query: "project:mcp-server", fields=['count()']

CRITICAL - HANDLING "ME" REFERENCES:
- If the query contains "me", "my", "myself", or "affecting me" in the context of user.id or user.email fields, use the whoami tool to get the user's ID and email
- For assignedTo fields, you can use "me" directly without translation (e.g., assignedTo:me works as-is)
- After calling whoami, replace "me" references with the actual user.id or user.email values
- If whoami fails, return an error explaining the issue

QUERY MODES:
1. INDIVIDUAL EVENTS (default): Returns raw event data
   - Used when fields contain no function() calls
   - Include recommended fields plus any user-requested fields

2. AGGREGATE QUERIES: Grouping and aggregation (NOT SQL)
   - Activated when ANY field contains a function() call
   - Fields should ONLY include: aggregate functions + groupBy fields
   - Automatically groups by ALL non-function fields
   - For aggregate queries, ONLY include the aggregate functions and groupBy fields - do NOT include default fields like timestamp, id, etc.

CRITICAL LIMITATION - TIME SERIES NOT SUPPORTED:
- Queries asking for data "over time", "by hour", "by day", "time series", or similar temporal groupings are NOT currently supported
- If user asks for "X over time", return an error explaining: "Time series aggregations are not currently supported."

CRITICAL - DO NOT USE SQL SYNTAX:
- NEVER use SQL functions like yesterday(), today(), now(), IS NOT NULL, IS NULL
- NEVER use SQL date functions - use timeRange parameter instead
- For "yesterday": Use timeRange: {"statsPeriod": "24h"}, NOT timestamp >= yesterday()
- For field existence: Use has:field_name, NOT field_name IS NOT NULL
- For field absence: Use !has:field_name, NOT field_name IS NULL

MATHEMATICAL QUERY PATTERNS:
When user asks mathematical questions like "how many tokens", "total tokens used", "token usage today":
- Use spans dataset (where OpenTelemetry data lives)
- Use datasetAttributes tool to find available token fields
- Use sum() function for total counts: sum(gen_ai.usage.input_tokens), sum(gen_ai.usage.output_tokens)
- For time-based queries ("today", "this week"), use timeRange parameter

DERIVED METRICS AND CALCULATIONS (SPANS ONLY):
When user asks for calculated metrics, ratios, or conversions:
- Use equation fields with "equation|" prefix
- Examples:
  - "duration in milliseconds" → fields: ["equation|avg(span.duration) * 1000"]
  - "total tokens" → fields: ["equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)"]
  - "error rate percentage" → fields: ["equation|failure_rate() * 100"]
  - "requests per second" → fields: ["equation|count() / 3600"] (for hourly data)
- IMPORTANT: Equations are ONLY supported in the spans dataset, NOT in errors or logs

SORTING RULES (CRITICAL - YOU MUST ALWAYS SPECIFY A SORT):
1. CRITICAL: Sort MUST go in the separate "sort" field, NEVER in the "query" field
   - WRONG: query: "level:error sort:-timestamp" ← Sort syntax in query field is FORBIDDEN
   - CORRECT: query: "level:error", sort: "-timestamp" ← Sort in separate field

2. DEFAULT SORTING:
   - errors dataset: Use "-timestamp" (newest first)
   - spans dataset: Use "-span.duration" (slowest first)  
   - logs dataset: Use "-timestamp" (newest first)

3. SORTING SYNTAX:
   - Use "-" prefix for descending order (e.g., "-timestamp" for newest first)
   - Use field name without prefix for ascending order
   - For aggregate queries: sort by aggregate function results (e.g., "-count()" for highest count first)

4. IMPORTANT SORTING REQUIREMENTS:
   - YOU MUST ALWAYS INCLUDE A SORT PARAMETER
   - CRITICAL: The field you sort by MUST be included in your fields array
   - If sorting by "-timestamp", include "timestamp" in fields
   - If sorting by "-count()", include "count()" in fields
   - This is MANDATORY - Sentry will reject queries where sort field is not in the selected fields

YOUR RESPONSE FORMAT:
Return a JSON object with these fields:
- "dataset": Which dataset you determined to use ("spans", "errors", or "logs")
- "query": The Sentry query string for filtering results (use empty string "" for no filters)
- "fields": Array of field names to return in results
  - For individual event queries: OPTIONAL (will use recommended fields if not provided)
  - For aggregate queries: REQUIRED (must include aggregate functions AND any groupBy fields)
- "sort": Sort parameter for results (REQUIRED - YOU MUST ALWAYS SPECIFY THIS)
- "timeRange": Time range parameters (optional)
  - Relative: {"statsPeriod": "24h"} for last 24 hours, "7d" for last 7 days, etc.
  - Absolute: {"start": "2025-06-19T07:00:00", "end": "2025-06-20T06:59:59"} for specific date ranges
- "error": Error message if you cannot translate the query (optional)

CORRECT QUERY PATTERNS (FOLLOW THESE):
- For field existence: Use has:field_name (NOT field_name IS NOT NULL)
- For field absence: Use !has:field_name (NOT field_name IS NULL)
- For time periods: Use timeRange parameter (NOT SQL date functions)
- Example: "models used yesterday" → query: "has:gen_ai.usage.input_tokens", timeRange: {"statsPeriod": "24h"}

PROCESS:
1. Analyze the user's query
2. Determine appropriate dataset
3. Use datasetAttributes tool to discover available fields
4. Use otelSemantics tool if needed for OpenTelemetry attributes
5. Construct the final query with proper fields and sort parameters

COMMON ERRORS TO AVOID:
- Using SQL syntax (IS NOT NULL, IS NULL, yesterday(), today(), etc.) - Use has: operator and timeRange instead
- Using numeric functions (sum, avg, min, max, percentiles) on non-numeric fields
- Using incorrect field names (use the otelSemantics tool to look up correct names)
- Missing required fields in the fields array for aggregate queries
- Invalid sort parameter not included in fields array
- For field existence: Use has:field_name (NOT field_name IS NOT NULL)
- For field absence: Use !has:field_name (NOT field_name IS NULL)
- For time periods: Use timeRange parameter (NOT SQL date functions like yesterday())`;

  // Create tools for the agent
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

  // Define the output schema for the agent
  const outputSchema = z
    .object({
      dataset: z
        .enum(["spans", "errors", "logs"])
        .optional()
        .describe("Which dataset to use for the query"),
      query: z
        .string()
        .optional()
        .describe(
          "The Sentry query string for filtering results (empty string returns all recent events)",
        ),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Array of field names to return in results. REQUIRED for aggregate queries (include only aggregate functions and groupBy fields). Optional for individual event queries (will use recommended fields if not provided).",
        ),
      sort: z
        .string()
        .optional()
        .describe(
          "REQUIRED: Sort parameter for results (e.g., '-timestamp' for newest first, '-count()' for highest count first)",
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
        ])
        .optional()
        .describe(
          "Time range for filtering events. Use either statsPeriod for relative time or start/end for absolute time.",
        ),
      error: z
        .string()
        .optional()
        .describe("Error message if the query cannot be translated"),
    })
    .superRefine((data, ctx) => {
      if (!data.error) {
        // If no error is present, dataset and sort must be defined
        if (data.dataset === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Dataset is required when no error is returned.",
            path: ["dataset"],
          });
        }
        if (data.sort === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Sort is required when no error is returned.",
            path: ["sort"],
          });
        }
      }
    });

  // Use callEmbeddedAgent to translate the query with tool call capture
  let agentResult: Awaited<ReturnType<typeof callEmbeddedAgent>>;
  try {
    agentResult = await callEmbeddedAgent({
      system: systemPrompt,
      prompt: query,
      tools: {
        datasetAttributes: datasetAttributesTool,
        otelSemantics: otelLookupTool,
        whoami: whoamiTool,
      },
      schema: outputSchema,
    });
  } catch (error) {
    // If the AI SDK failed to parse the output, return a safe error object
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Return a safe error response that matches our schema
    return {
      result: {
        error: `AI failed to generate a valid query translation. This may happen when the query is too complex or ambiguous. Please try rephrasing your query. Details: ${errorMessage}`,
      },
      toolCalls: [],
    };
  }

  // Return both the result and tool calls
  return {
    result: {
      dataset: agentResult.result.dataset,
      query: agentResult.result.query,
      fields: agentResult.result.fields,
      sort: agentResult.result.sort,
      timeRange: agentResult.result.timeRange,
      error: agentResult.result.error,
    },
    toolCalls: agentResult.toolCalls,
  };
}
