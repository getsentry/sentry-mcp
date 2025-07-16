import { z } from "zod";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { ConfigurationError } from "../../errors";
import type { SentryApiService } from "../../api-client";

// Type definitions
export interface QueryTranslationResult {
  query: string;
  fields?: string[];
  sort: string;
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

// Base system prompt template
const SYSTEM_PROMPT_TEMPLATE = `You are a Sentry query translator. You need to:
1. Convert the natural language query to Sentry's search syntax (the WHERE conditions)
2. Decide which fields to return in the results (the SELECT fields)
3. Understand when to use aggregate functions vs individual events

IMPORTANT: When translating queries about "agent calls" or "AI", use gen_ai.* attributes (OpenTelemetry GenAI semantic conventions). For "tool calls", use mcp.* attributes. For database queries, use db.* attributes. For HTTP requests, use http.* attributes.

For the {dataset} dataset:

RECOMMENDED FIELDS TO RETURN:
{recommendedFields}

ALL AVAILABLE FIELDS:
{fields}

AGGREGATE FUNCTIONS BY DATASET:
{aggregateFunctions}

QUERY MODES:
1. INDIVIDUAL EVENTS (default): Returns raw event data
   - Used when fields contain no function() calls
   - Returns actual event occurrences with full details
   - Include default fields plus any user-requested fields

2. AGGREGATE QUERIES: SQL-like grouping and aggregation
   - Activated when ANY field contains a function() call
   - Fields should ONLY include: aggregate functions + groupBy fields
   - DO NOT include default fields (id, timestamp, etc.) in aggregate queries
   - Automatically groups by ALL non-function fields in the field list
   - Example: fields=['ai.model.id', 'count()'] groups by ai.model.id and shows count
   - Example: fields=['ai.model.id', 'ai.model.provider', 'avg(span.duration)'] groups by model and provider

QUERY SYNTAX RULES:
- Use field:value for exact matches
- Use field:>value or field:<value for numeric comparisons
- Use AND, OR, NOT for boolean logic
- Use quotes for phrases with spaces
- Use wildcards (*) for partial matches
- For timestamp filters:
  - Spans/Errors datasets: Use timestamp:-1h format (e.g., timestamp:-1h for last hour, timestamp:-24h for last day)  
  - Logs dataset: Do NOT include timestamp filters in query - time filtering handled separately
  - Absolute times: Use comparison operators with ISO dates (e.g., timestamp:<=2025-07-11T04:52:50.511Z)
- IMPORTANT: For relative durations, use format WITHOUT operators (timestamp:-1h NOT timestamp:>-1h)
{datasetRules}

EXAMPLES:
{datasetExamples}

SORTING RULES (CRITICAL - YOU MUST ALWAYS SPECIFY A SORT):
1. DEFAULT SORTING:
   - errors dataset: Use "-timestamp" (newest first)
   - spans dataset: Use "-span.duration" (slowest first)  
   - logs dataset: Use "-timestamp" (newest first)

2. SORTING SYNTAX:
   - Use "-" prefix for descending order (e.g., "-timestamp" for newest first)
   - Use field name without prefix for ascending order (e.g., "timestamp" for oldest first)
   - For individual event queries: sort by any field in the dataset
   - For aggregate queries: sort by aggregate function results (e.g., "-count()" for highest count first)

3. AGGREGATE QUERY SORTING:
   - When using aggregate functions, sort by the function result
   - Examples: "-count()" for highest count, "-avg(span.duration)" for slowest average
   - Common patterns: "-count()", "-sum(field)", "-avg(field)", "-max(field)"

4. IMPORTANT SORTING REQUIREMENTS:
   - YOU MUST ALWAYS INCLUDE A SORT PARAMETER
   - CRITICAL: The field you sort by MUST be included in your fields array
   - If sorting by "-timestamp", include "timestamp" in fields
   - If sorting by "-count()", include "count()" in fields
   - If sorting by "-span.duration", include "span.duration" in fields
   - If user asks for "most common", use "-count()"
   - If user asks for "slowest", use "-span.duration" or "-avg(span.duration)"
   - If user asks for "latest" or "recent", use "-timestamp"
   - If unsure, use the default sort for the dataset

YOUR RESPONSE FORMAT:
Return a JSON object with these fields:
- "query": The Sentry query string for filtering results (use empty string "" for no filters)
- "fields": Array of field names to return in results
  - For individual event queries: OPTIONAL (will use recommended fields if not provided)
  - For aggregate queries: REQUIRED (must include aggregate functions like "count()", "avg(span.duration)" AND any groupBy fields)
  - The system will automatically detect aggregate queries by the presence of function fields
- "sort": Sort parameter for results (REQUIRED - YOU MUST ALWAYS SPECIFY THIS)
- "timeRange": Time range parameters (OPTIONAL - only include if user specifies a time period)
  - Use ONLY ONE of these formats:
  - Relative: {"statsPeriod": "24h"} for last 24 hours, "7d" for last 7 days, etc.
  - Absolute: {"start": "2025-06-19T07:00:00", "end": "2025-06-20T06:59:59"} for specific date ranges
  - If no time is specified, omit this field entirely (defaults to last 14 days)
- "error": Error message if you cannot translate the query (OPTIONAL)

ERROR HANDLING:
- If the user's query is impossible to translate to Sentry syntax, set "error" field with explanation
- If the query asks for fields that don't exist in the dataset, set "error" field
- If the query is ambiguous or unclear, set "error" field with clarification needed

IMPORTANT NOTES:
- FIELDS ARRAY REQUIREMENTS:
  - For individual event queries: Optional (recommended fields will be used if not provided)
  - For aggregate queries: REQUIRED and must contain ONLY aggregate functions and groupBy fields
  - Do NOT mix regular fields with aggregate functions unless they are groupBy fields
- Add any fields mentioned in the user's query to the fields array
- If the user asks about a specific field (e.g., "show me user emails"), include that field
- CRITICAL: The field you're sorting by MUST be included in your fields array (e.g., if sort is "-timestamp", fields must include "timestamp")
- Do NOT include project: filters in your query (project filtering is handled separately)
- For spans/errors: When user mentions time periods, include timestamp filters in query
- For logs: When user mentions time periods, do NOT include timestamp filters - handled automatically
- AGGREGATE FUNCTION RULES:
  - Numeric functions (avg, sum, min, max, percentiles) ONLY work with numeric fields
  - count() and count_unique() work with any field type
  - When using aggregate functions, results are grouped by non-function fields
  - Dataset-specific functions must only be used with their respective datasets

AGGREGATE QUERY RESPONSE STRUCTURE:
When creating an aggregate query:
1. Include ALL aggregate functions (e.g., "count()", "avg(span.duration)") in the fields array
2. Include ALL groupBy fields (non-function fields) in the fields array
3. The query is automatically treated as aggregate if ANY field contains a function (has parentheses)
4. IMPORTANT: For aggregate queries, ONLY include the aggregate functions and groupBy fields - do NOT include default fields like timestamp, id, etc.

Examples:
- "count of errors by type": fields=["error.type", "count()"]
- "average span duration": fields=["avg(span.duration)"]
- "most common transaction": fields=["span.description", "count()"], sort="-count()"
- "p50 duration by model and operation": fields=["ai.model.id", "ai.operationId", "p50(span.duration)"], sort="-p50(span.duration)"`;

/**
 * Build the system prompt for AI query translation
 */
function buildSystemPrompt(
  dataset: "spans" | "errors" | "logs",
  allFields: Record<string, string>,
  datasetConfig: { rules: string; examples: string },
  recommendedFields: { basic: string[]; description: string },
): string {
  // Define aggregate functions for each dataset
  const aggregateFunctions = {
    errors: `ERRORS dataset aggregate functions:
- count(): Count of error events
- count_unique(field): Count unique values (e.g., count_unique(user.id))
- count_if(field,equals,value): Conditional count (e.g., count_if(error.handled,equals,false))
- last_seen(): Most recent timestamp in the group
- eps(): Events per second rate
- epm(): Events per minute rate`,
    spans: `SPANS dataset aggregate functions:
- count(): Count of spans
- count_unique(field): Count unique values (e.g., count_unique(user.id))
- avg(field): Average of numeric field (e.g., avg(span.duration))
- sum(field): Sum of numeric field (e.g., sum(span.self_time))
- min(field): Minimum value (e.g., min(span.duration))
- max(field): Maximum value (e.g., max(span.duration))
- p50(field), p75(field), p90(field), p95(field), p99(field), p100(field): Percentiles
- epm(): Events per minute rate
- failure_rate(): Percentage of failed spans`,
    logs: `LOGS dataset aggregate functions:
- count(): Count of log entries
- count_unique(field): Count unique values (e.g., count_unique(user.id))
- avg(field): Average of numeric field (e.g., avg(severity_number))
- sum(field): Sum of numeric field
- min(field): Minimum value
- max(field): Maximum value
- p50(field), p75(field), p90(field), p95(field), p99(field), p100(field): Percentiles
- epm(): Events per minute rate`,
  };

  return SYSTEM_PROMPT_TEMPLATE.replace("{dataset}", dataset)
    .replace(
      "{recommendedFields}",
      `${recommendedFields.basic.map((f) => `- ${f}`).join("\n")}\n\n${recommendedFields.description}`,
    )
    .replace(
      "{fields}",
      Object.entries(allFields)
        .map(([key, desc]) => `- ${key}: ${desc}`)
        .join("\n"),
    )
    .replace("{aggregateFunctions}", aggregateFunctions[dataset])
    .replace("{datasetRules}", datasetConfig.rules)
    .replace("{datasetExamples}", datasetConfig.examples);
}

/**
 * Translate natural language query to Sentry search syntax using AI
 */
export async function translateQuery(
  params: QueryTranslationParams,
  apiService: SentryApiService,
  organizationSlug: string,
  projectId?: string,
): Promise<QueryTranslationResult> {
  // Check if OpenAI API key is available
  if (!process.env.OPENAI_API_KEY) {
    throw new ConfigurationError(
      "OPENAI_API_KEY environment variable is required for semantic search",
    );
  }

  // Build the system prompt
  const systemPrompt = buildSystemPrompt(
    params.dataset,
    params.allFields,
    params.datasetConfig,
    params.recommendedFields,
  );

  // Use the AI SDK to translate the query
  const { object: parsed } = await generateObject({
    model: openai("gpt-4o"),
    system: systemPrompt,
    prompt: params.naturalLanguageQuery,
    temperature: 0.1, // Low temperature for more consistent translations
    schema: z.object({
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
    }),
    experimental_telemetry: {
      isEnabled: true,
      functionId: `search_events_${params.dataset}`,
    },
  });

  return {
    query: parsed.query || "",
    fields: parsed.fields,
    sort: parsed.sort,
    timeRange: parsed.timeRange,
    error: parsed.error,
  };
}
