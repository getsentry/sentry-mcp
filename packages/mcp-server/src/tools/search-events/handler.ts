import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../utils/defineTool";
import {
  apiServiceFromContext,
  withApiErrorHandling,
} from "../utils/api-utils";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../../schema";
import { translateQuery } from "./agent";
import {
  formatErrorResults,
  formatLogResults,
  formatSpanResults,
} from "./formatters";
import { RECOMMENDED_FIELDS } from "./config";
import { UserInputError } from "../../errors";
import type { SentryApiService } from "../../api-client";
import { ApiError } from "../../api-client";

/**
 * Translate query with error feedback for self-correction
 */
async function translateQueryWithErrorFeedback(
  params: {
    naturalLanguageQuery: string;
    organizationSlug: string;
    projectId?: string;
  },
  apiService: SentryApiService,
  maxRetries = 1,
) {
  let previousError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await translateQuery(
        params,
        apiService,
        params.organizationSlug,
        params.projectId,
        previousError,
      );

      return result;
    } catch (error) {
      if (error instanceof UserInputError && attempt < maxRetries) {
        // Feed the validation error back to the agent for self-correction
        previousError = error.message;
        continue;
      }
      // Re-throw if it's not a UserInputError or we've exceeded retries
      throw error;
    }
  }

  // This should never be reached due to the throw above, but TypeScript needs it
  throw new Error("Unexpected error in translateQueryWithErrorFeedback");
}

export default defineTool({
  name: "search_events",
  description: [
    "Search for error events, log entries, or trace spans. Supports both individual event queries and SQL-like aggregations.",
    "",
    "Automatically uses natural language to search across Sentry data, returning either:",
    "- Individual events with full details (default)",
    "- Aggregated results when using functions like count(), avg(), sum(), etc.",
    "",
    "Dataset Selection (AI agent determines the appropriate dataset):",
    "- errors: Exception/crash events",
    "- logs: Log entries (use for 'error logs')",
    "- spans: Performance/trace data, AI/LLM calls, token usage",
    "",
    "Intelligence: AI agent analyzes the query to choose the correct dataset and fields",
    "",
    "❌ DO NOT USE for 'issues' or 'problems' (use search_issues instead)",
    "",
    "📚 For detailed API patterns and examples, see: docs/search-events-api-patterns.md",
    "",
    "<examples>",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='database errors in the last hour')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='how many tokens used today')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='slowest API calls')",
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
      try {
        const project = await apiService.getProject({
          organizationSlug,
          projectSlugOrId: params.projectSlug,
        });
        projectId = String(project.id);
      } catch (error) {
        throw new Error(
          `Project '${params.projectSlug}' not found in organization '${organizationSlug}'`,
        );
      }
    }

    // Translate the natural language query using Search Events Agent with error feedback
    // The agent will determine the dataset and fetch the appropriate attributes
    const parsed = await translateQueryWithErrorFeedback(
      {
        naturalLanguageQuery: params.naturalLanguageQuery,
        organizationSlug,
        projectId,
      },
      apiService,
      1, // Max 1 retry with error feedback
    );

    // Handle Search Events Agent errors first
    if (parsed.error) {
      throw new Error(
        `Search Events Agent could not translate query "${params.naturalLanguageQuery}". Error: ${parsed.error}`,
      );
    }

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

    let eventsResponse: unknown;
    try {
      eventsResponse = await withApiErrorHandling(
        () =>
          apiService.searchEvents({
            organizationSlug,
            query: sentryQuery,
            fields,
            limit: params.limit,
            projectSlug: projectId, // API requires numeric project ID, not slug
            dataset: dataset === "logs" ? "ourlogs" : dataset,
            sort: sortParam,
            ...timeParams, // Spread the time parameters
          }),
        {
          organizationSlug,
          projectSlug: params.projectSlug,
        },
      );
    } catch (error) {
      // Convert API validation errors to UserInputError for agent self-correction
      if (
        error instanceof ApiError &&
        (error.status === 400 || error.status === 422)
      ) {
        // 400 Bad Request and 422 Unprocessable Entity typically indicate input validation issues
        throw new UserInputError(error.message);
      }

      // Re-throw other errors (5xx, network errors, etc.) as-is
      throw error;
    }

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
    switch (dataset) {
      case "errors":
        return formatErrorResults(
          eventData,
          params,
          apiService,
          organizationSlug,
          explorerUrl,
          sentryQuery,
          fields,
        );
      case "logs":
        return formatLogResults(
          eventData,
          params,
          apiService,
          organizationSlug,
          explorerUrl,
          sentryQuery,
          fields,
        );
      case "spans":
        return formatSpanResults(
          eventData,
          params,
          apiService,
          organizationSlug,
          explorerUrl,
          sentryQuery,
          fields,
        );
    }
  },
});
