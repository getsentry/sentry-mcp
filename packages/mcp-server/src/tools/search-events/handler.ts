import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../../schema";
import { searchEventsAgent } from "./agent";
import {
  formatErrorResults,
  formatLogResults,
  formatSpanResults,
} from "./formatters";
import { RECOMMENDED_FIELDS } from "./config";
import { UserInputError } from "../../errors";

export default defineTool({
  name: "search_events",
  requiredSkills: ["inspect", "triage", "seer"], // Available in inspect, triage, and seer skills
  requiredScopes: ["event:read"],
  description: [
    "Search for events AND perform counts/aggregations - the ONLY tool for statistics and counts.",
    "",
    "Supports TWO query types:",
    "1. AGGREGATIONS (counts, sums, averages): 'how many errors', 'count of issues', 'total tokens'",
    "2. Individual events with timestamps: 'show me error logs from last hour'",
    "",
    "🔢 USE THIS FOR ALL COUNTS/STATISTICS:",
    "- 'how many errors today' → returns count",
    "- 'count of database failures' → returns count",
    "- 'total number of issues' → returns count",
    "- 'average response time' → returns avg()",
    "- 'sum of tokens used' → returns sum()",
    "",
    "📋 ALSO USE FOR INDIVIDUAL EVENTS:",
    "- 'error logs from last hour' → returns event list",
    "- 'database errors with timestamps' → returns event list",
    "- 'trace spans for slow API calls' → returns span list",
    "",
    "Dataset Selection (AI automatically chooses):",
    "- errors: Exception/crash events",
    "- logs: Log entries",
    "- spans: Performance data, AI/LLM calls, token usage",
    "",
    "❌ DO NOT USE for grouped issue lists → use search_issues",
    "",
    "<examples>",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='how many errors today')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='count of database failures this week')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='total tokens used by model')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='error logs from the last hour')",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, it's likely in the format of <organizationSlug>/<projectSlug>.",
    "- Parse org/project notation directly without calling find_organizations or find_projects.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .describe("Natural language description of what you want to search for"),
    projectSlug: ParamProjectSlug.optional(),
    regionUrl: ParamRegionUrl.optional(),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe("Maximum number of results to return"),
    includeExplanation: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include explanation of how the query was translated"),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    if (params.projectSlug) setTag("project.slug", params.projectSlug);

    // The agent will determine the dataset based on the query content

    // Convert project slug to ID if needed - we need this for attribute fetching
    let projectId: string | undefined;
    if (params.projectSlug) {
      const project = await apiService.getProject({
        organizationSlug,
        projectSlugOrId: params.projectSlug!,
      });
      projectId = String(project.id);
    }

    // Translate the natural language query using Search Events Agent
    // The agent will determine the dataset and fetch the appropriate attributes
    const agentResult = await searchEventsAgent({
      query: params.naturalLanguageQuery,
      organizationSlug,
      apiService,
      projectId,
    });

    const parsed = agentResult.result;

    // Get the dataset chosen by the agent (should be defined when no error)
    const dataset = parsed.dataset!;

    // Get recommended fields for this dataset (for fallback when no fields are provided)
    const recommendedFields = RECOMMENDED_FIELDS[dataset];

    // Validate that sort parameter was provided
    if (!parsed.sort) {
      throw new UserInputError(
        `Search Events Agent response missing required 'sort' parameter. Received: ${JSON.stringify(parsed, null, 2)}. The agent must specify how to sort results (e.g., '-timestamp' for newest first, '-count()' for highest count).`,
      );
    }

    // Use empty string as default if no query is provided
    // This allows fetching all recent events when no specific filter is needed
    const sentryQuery = parsed.query || "";
    const requestedFields = parsed.fields || [];

    // Determine if this is an aggregate query by checking if any field contains a function
    const isAggregateQuery = requestedFields.some(
      (field) => field.includes("(") && field.includes(")"),
    );

    // For aggregate queries, we should only use the fields provided by the AI
    // For non-aggregate queries, we can use recommended fields as fallback
    let fields: string[];

    if (isAggregateQuery) {
      // For aggregate queries, fields must be provided and should only include
      // aggregate functions and groupBy fields
      if (!requestedFields || requestedFields.length === 0) {
        throw new UserInputError(
          `AI response missing required 'fields' for aggregate query. The AI must specify which fields to return. For aggregate queries, include only the aggregate functions (like count(), avg()) and groupBy fields.`,
        );
      }
      fields = requestedFields;
    } else {
      // For non-aggregate queries, use AI-provided fields or fall back to recommended fields
      fields =
        requestedFields && requestedFields.length > 0
          ? requestedFields
          : recommendedFields.basic;
    }

    // Use the AI-provided sort parameter
    const sortParam = parsed.sort;

    // Extract time range parameters from parsed response
    const timeParams: { statsPeriod?: string; start?: string; end?: string } =
      {};
    if (parsed.timeRange) {
      if ("statsPeriod" in parsed.timeRange) {
        timeParams.statsPeriod = parsed.timeRange.statsPeriod;
      } else if ("start" in parsed.timeRange && "end" in parsed.timeRange) {
        timeParams.start = parsed.timeRange.start;
        timeParams.end = parsed.timeRange.end;
      }
    } else {
      // Default time window if not specified
      timeParams.statsPeriod = "14d";
    }

    const eventsResponse = await apiService.searchEvents({
      organizationSlug,
      query: sentryQuery,
      fields,
      limit: params.limit,
      projectId, // API requires numeric project ID, not slug
      dataset: dataset === "logs" ? "ourlogs" : dataset,
      sort: sortParam,
      ...timeParams, // Spread the time parameters
    });

    // Generate the Sentry explorer URL with structured aggregate information
    // Derive aggregate functions and groupBy fields from the fields array
    const aggregateFunctions = fields.filter(
      (field) => field.includes("(") && field.includes(")"),
    );
    const groupByFields = fields.filter(
      (field) => !field.includes("(") && !field.includes(")"),
    );

    const explorerUrl = apiService.getEventsExplorerUrl(
      organizationSlug,
      sentryQuery,
      projectId, // Pass the numeric project ID for URL generation
      dataset, // dataset is already correct for URL generation (logs, spans, errors)
      fields, // Pass fields to detect if it's an aggregate query
      sortParam, // Pass sort parameter for URL generation
      aggregateFunctions,
      groupByFields,
      timeParams.statsPeriod,
      timeParams.start,
      timeParams.end,
    );

    // Type-safe access to event data with proper validation
    function isValidResponse(
      response: unknown,
    ): response is { data?: unknown[] } {
      return typeof response === "object" && response !== null;
    }

    function isValidEventArray(
      data: unknown,
    ): data is Record<string, unknown>[] {
      return (
        Array.isArray(data) &&
        data.every((item) => typeof item === "object" && item !== null)
      );
    }

    if (!isValidResponse(eventsResponse)) {
      throw new Error("Invalid response format from Sentry API");
    }

    const eventData = eventsResponse.data;
    if (!isValidEventArray(eventData)) {
      throw new Error("Invalid event data format from Sentry API");
    }

    // Format results based on dataset
    const formatParams = {
      eventData,
      naturalLanguageQuery: params.naturalLanguageQuery,
      includeExplanation: params.includeExplanation,
      apiService,
      organizationSlug,
      explorerUrl,
      sentryQuery,
      fields,
      explanation: parsed.explanation,
    };

    switch (dataset) {
      case "errors":
        return formatErrorResults(formatParams);
      case "logs":
        return formatLogResults(formatParams);
      case "spans":
        return formatSpanResults(formatParams);
    }
  },
});
