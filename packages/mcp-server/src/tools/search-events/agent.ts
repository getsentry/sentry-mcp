import { z } from "zod";
import { generateText, tool, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { ConfigurationError, UserInputError } from "../../errors";
import type { SentryApiService } from "../../api-client";
import { lookupOtelSemantics } from "./tools/otel-semantics-lookup";

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

// Base system prompt template
const SYSTEM_PROMPT_TEMPLATE = `You are a Sentry query translator. You need to:
1. Convert the natural language query to Sentry's search syntax (the WHERE conditions)
2. Decide which fields to return in the results (the SELECT fields)
3. Understand when to use aggregate functions vs individual events

CRITICAL DATASET SELECTION RULES:
- Mathematical queries about token usage, costs, or AI metrics → ALWAYS use spans dataset
- Queries asking for sums, averages, totals, or counts of usage → ALWAYS use spans dataset
- Queries about "how many tokens", "total tokens", "token usage", "costs" → ALWAYS use spans dataset
- Error messages, exceptions, crashes → use errors dataset
- Log entries, log messages → use logs dataset
- Performance data, traces, spans, AI calls → use spans dataset

IMPORTANT SEMANTIC CONVENTIONS:
- "agent calls", "AI calls", "LLM calls" → use gen_ai.* attributes (OpenTelemetry GenAI semantic conventions)
- "tool calls", "MCP calls" → use mcp.* attributes
- "database queries" → use db.* attributes
- "HTTP requests", "API calls" → use http.* attributes
- "token usage", "tokens used", "input tokens", "output tokens" → use gen_ai.usage.* attributes
- "user agents", "user agent strings", "browser", "client" → use user_agent.original attribute

CRITICAL TOOL USAGE: You have access to the otelSemantics tool to look up OpenTelemetry semantic convention attributes. Use this tool when:
- The query asks about concepts that should have OpenTelemetry attributes but you don't see them in the available fields
- You need to find the correct attribute names for token usage, AI calls, database queries, HTTP requests, etc.

WHEN TO USE THE TOOL:
- "tokens used", "token usage", "input tokens", "output tokens" → call otelSemantics with namespace "gen_ai"
- "agent calls", "AI calls", "LLM calls", "model usage" → call otelSemantics with namespace "gen_ai"
- "database queries", "SQL", "DB operations" → call otelSemantics with namespace "db"
- "HTTP requests", "API calls", "web requests" → call otelSemantics with namespace "http"
- "tool calls", "MCP calls" → call otelSemantics with namespace "mcp"
- "user agents", "browser", "client", "user agent strings" → call datasetAttributes to find user_agent fields

IMPORTANT: Always use the tool to get the exact attribute names before constructing your query, especially for mathematical operations like sum(gen_ai.usage.input_tokens).

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

MATHEMATICAL QUERY PATTERNS:
When user asks mathematical questions like "how many tokens", "total tokens used", "token usage today":
- Use spans dataset (where OpenTelemetry data lives)
- Use sum() function for total token counts: sum(gen_ai.usage.input_tokens), sum(gen_ai.usage.output_tokens)
- Use has:gen_ai.usage.input_tokens to filter for AI calls with token data
- For time-based queries ("today", "this week"), use timeRange parameter
- Examples:
  - "how many tokens used today" → query: "has:gen_ai.usage.input_tokens", fields: ["sum(gen_ai.usage.input_tokens)", "sum(gen_ai.usage.output_tokens)"], timeRange: {"statsPeriod": "24h"}
  - "total input tokens by model" → query: "has:gen_ai.usage.input_tokens", fields: ["gen_ai.request.model", "sum(gen_ai.usage.input_tokens)"]

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
 * Create the otel-semantics-lookup tool for the AI agent
 */
function createOtelLookupTool(
  apiService: SentryApiService,
  organizationSlug: string,
  projectId?: string,
) {
  return tool({
    description:
      "Look up OpenTelemetry semantic convention attributes for a specific namespace. OpenTelemetry attributes are universal standards that work across all datasets.",
    parameters: z.object({
      namespace: z
        .string()
        .describe(
          "The OpenTelemetry namespace to look up (e.g., 'gen_ai', 'db', 'http', 'mcp')",
        ),
      searchTerm: z
        .string()
        .optional()
        .describe("Optional search term to filter attributes"),
      dataset: z
        .enum(["spans", "errors", "logs"])
        .describe(
          "REQUIRED: Dataset to check attribute availability in. The agent MUST specify this based on their chosen dataset.",
        ),
    }),
    execute: async ({ namespace, searchTerm, dataset }) => {
      try {
        return await lookupOtelSemantics(
          namespace,
          searchTerm,
          dataset,
          apiService,
          organizationSlug,
          projectId,
        );
      } catch (error) {
        if (error instanceof UserInputError) {
          return `Error: ${error.message}`;
        }
        throw error;
      }
    },
  });
}

/**
 * Create a tool for the agent to query available attributes by dataset
 */
function createDatasetAttributesTool(
  apiService: SentryApiService,
  organizationSlug: string,
  projectId?: string,
) {
  return tool({
    description:
      "Query available attributes and fields for a specific Sentry dataset to understand what data is available",
    parameters: z.object({
      dataset: z
        .enum(["spans", "errors", "logs"])
        .describe("The dataset to query attributes for"),
    }),
    execute: async ({ dataset }) => {
      try {
        const { fetchCustomAttributes } = await import("./utils");
        const {
          BASE_COMMON_FIELDS,
          DATASET_FIELDS,
          RECOMMENDED_FIELDS,
          NUMERIC_FIELDS,
        } = await import("./config");

        // Get custom attributes for this dataset
        const { attributes: customAttributes, fieldTypes } =
          await fetchCustomAttributes(
            apiService,
            organizationSlug,
            dataset,
            projectId,
          );

        // Combine all available fields
        const allFields = {
          ...BASE_COMMON_FIELDS,
          ...DATASET_FIELDS[dataset],
          ...customAttributes,
        };

        const recommendedFields = RECOMMENDED_FIELDS[dataset];

        // Combine field types from both static config and dynamic API
        const allFieldTypes = { ...fieldTypes };
        const staticNumericFields = NUMERIC_FIELDS[dataset] || new Set();
        for (const field of staticNumericFields) {
          allFieldTypes[field] = "number";
        }

        return `Dataset: ${dataset}

Available Fields (${Object.keys(allFields).length} total):
${Object.entries(allFields)
  .slice(0, 50) // Limit to first 50 to avoid overwhelming the agent
  .map(([key, desc]) => `- ${key}: ${desc}`)
  .join("\n")}
${Object.keys(allFields).length > 50 ? `\n... and ${Object.keys(allFields).length - 50} more fields` : ""}

Recommended Fields for ${dataset}:
${recommendedFields.basic.map((f) => `- ${f}`).join("\n")}

Field Types (CRITICAL for aggregate functions):
${Object.entries(allFieldTypes)
  .slice(0, 30) // Show more field types since this is critical for validation
  .map(([key, type]) => `- ${key}: ${type}`)
  .join("\n")}
${Object.keys(allFieldTypes).length > 30 ? `\n... and ${Object.keys(allFieldTypes).length - 30} more fields` : ""}

IMPORTANT: Only use numeric aggregate functions (avg, sum, min, max, percentiles) with numeric fields. Use count() or count_unique() for non-numeric fields.

Use this information to construct appropriate queries for the ${dataset} dataset.`;
      } catch (error) {
        if (error instanceof UserInputError) {
          return `Error: ${error.message}`;
        }
        throw error;
      }
    },
  });
}

/**
 * Translate natural language query to Sentry search syntax using AI
 */
export async function translateQuery(
  params: Omit<
    QueryTranslationParams,
    "dataset" | "allFields" | "datasetConfig" | "recommendedFields"
  >,
  apiService: SentryApiService,
  organizationSlug: string,
  projectId?: string,
  previousError?: string,
): Promise<QueryTranslationResult & { dataset?: "spans" | "errors" | "logs" }> {
  // Check if OpenAI API key is available
  if (!process.env.OPENAI_API_KEY) {
    throw new ConfigurationError(
      "OPENAI_API_KEY environment variable is required for semantic search",
    );
  }

  // Build a dataset-agnostic system prompt
  let systemPrompt = `You are a Sentry query translator. You need to:
1. FIRST determine which dataset (spans, errors, or logs) is most appropriate for the query
2. Query the available attributes for that dataset using the datasetAttributes tool
3. Use the otelSemantics tool if you need OpenTelemetry semantic conventions
4. Convert the natural language query to Sentry's search syntax
5. Decide which fields to return in the results

DATASET SELECTION GUIDELINES:
- spans: Performance data, traces, AI/LLM calls, database queries, HTTP requests, token usage, costs, duration metrics, user agent data
- errors: Exceptions, crashes, error messages, stack traces, unhandled errors, browser/client errors
- logs: Log entries, log messages, severity levels, debugging information

CRITICAL TOOL USAGE:
1. Use datasetAttributes tool to discover what fields are available for your chosen dataset
2. Use otelSemantics tool when you need specific OpenTelemetry attributes (gen_ai.*, db.*, http.*, etc.)
3. IMPORTANT: For ambiguous terms like "user agents", "browser", "client" - ALWAYS use the datasetAttributes tool to find the correct field name (typically user_agent.original) instead of assuming it's related to user.id

QUERY MODES:
1. INDIVIDUAL EVENTS (default): Returns raw event data
   - Used when fields contain no function() calls
   - Include recommended fields plus any user-requested fields

2. AGGREGATE QUERIES: SQL-like grouping and aggregation
   - Activated when ANY field contains a function() call
   - Fields should ONLY include: aggregate functions + groupBy fields
   - Automatically groups by ALL non-function fields

MATHEMATICAL QUERY PATTERNS:
When user asks mathematical questions like "how many tokens", "total tokens used", "token usage today":
- Use spans dataset (where OpenTelemetry data lives)
- Use datasetAttributes tool to find available token fields
- Use sum() function for total counts: sum(gen_ai.usage.input_tokens), sum(gen_ai.usage.output_tokens)
- For time-based queries ("today", "this week"), use timeRange parameter

YOUR RESPONSE FORMAT:
Return a JSON object with these fields:
- "dataset": Which dataset you determined to use ("spans", "errors", or "logs")
- "query": The Sentry query string for filtering results
- "fields": Array of field names to return in results
- "sort": Sort parameter for results (REQUIRED)
- "timeRange": Time range parameters (optional)
- "error": Error message if you cannot translate the query (optional)

PROCESS:
1. Analyze the user's query
2. Determine appropriate dataset
3. Use datasetAttributes tool to discover available fields
4. Use otelSemantics tool if needed for OpenTelemetry attributes
5. Construct the final query with proper fields and sort parameters`;

  // Add error feedback if this is a retry
  if (previousError) {
    systemPrompt += `

IMPORTANT ERROR CORRECTION:
Your previous query translation failed with this error:
${previousError}

Please analyze the error and correct your approach. Common issues:
- Using numeric functions (sum, avg, min, max, percentiles) on non-numeric fields
- Using incorrect field names (use the otelSemantics tool to look up correct names)
- Missing required fields in the fields array for aggregate queries
- Invalid sort parameter not included in fields array

Fix the issue and try again with the corrected query.`;
  }

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

  // Use the AI SDK to translate the query with tools and structured output
  const result = await generateText({
    model: openai("gpt-4o"),
    system: systemPrompt,
    prompt: params.naturalLanguageQuery,
    tools: {
      datasetAttributes: datasetAttributesTool,
      otelSemantics: otelLookupTool,
    },
    temperature: 0.1, // Low temperature for more consistent translations
    experimental_output: Output.object({
      schema: z
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
        }),
    }),
    experimental_telemetry: {
      isEnabled: true,
      functionId: "search_events_agent",
    },
  });

  let parsed: any;
  try {
    parsed = result.experimental_output;
  } catch (error) {
    // If the AI SDK failed to parse the output, return a safe error object
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Return a safe error response that matches our schema
    return {
      error: `AI failed to generate a valid query translation. This may happen when the query is too complex or ambiguous. Please try rephrasing your query. Details: ${errorMessage}`,
    };
  }

  return {
    dataset: parsed.dataset,
    query: parsed.query,
    fields: parsed.fields,
    sort: parsed.sort,
    timeRange: parsed.timeRange,
    error: parsed.error,
  };
}
