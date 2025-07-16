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
import { fetchCustomAttributes } from "./utils";
import {
  formatErrorResults,
  formatLogResults,
  formatSpanResults,
} from "./formatters";
import {
  BASE_COMMON_FIELDS,
  DATASET_FIELDS,
  DATASET_CONFIGS,
  NUMERIC_FIELDS,
  RECOMMENDED_FIELDS,
} from "./config";

export default defineTool({
  name: "search_events",
  description: [
    "Search for error events, log entries, or trace spans. Supports both individual event queries and SQL-like aggregations.",
    "",
    "Automatically uses natural language to search across Sentry data, returning either:",
    "- Individual events with full details (default)",
    "- Aggregated results when using functions like count(), avg(), sum(), etc.",
    "",
    "Datasets:",
    "- errors: Exception/crash events",
    "- logs: Log entries (use for 'error logs')",
    "- spans: Performance/trace data",
    "",
    "❌ DO NOT USE for 'issues' or 'problems' (use find_issues instead)",
    "",
    "📚 For detailed API patterns and examples, see: docs/search-events-api-patterns.md",
    "",
    "<examples>",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='database errors in the last hour', dataset='errors')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='count of errors by type', dataset='errors')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='slowest API calls', dataset='spans')",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .describe("Natural language description of what you want to search for"),
    dataset: z
      .enum(["spans", "errors", "logs"])
      .optional()
      .default("errors")
      .describe(
        "The dataset to search in (errors for exceptions, spans for traces/performance, logs for log data)",
      ),
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

    // Use errors dataset by default if not specified
    const dataset = params.dataset || "errors";

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

    // Get the dataset-specific fields
    const datasetSpecificFields = DATASET_FIELDS[dataset];

    // Fetch custom attributes based on dataset
    const { attributes: customAttributes, fieldTypes: customFieldTypes } =
      await fetchCustomAttributes(
        apiService,
        organizationSlug,
        dataset,
        projectId,
      );

    // Combine base fields, dataset-specific fields, and custom attributes
    const allFields = {
      ...BASE_COMMON_FIELDS,
      ...datasetSpecificFields,
      ...customAttributes,
    };

    // Build complete field type map
    const allFieldTypes = new Map<string, "string" | "number">();

    // Add known numeric fields
    const datasetNumericFields = NUMERIC_FIELDS[dataset] || new Set();
    for (const field of datasetNumericFields) {
      allFieldTypes.set(field, "number");
    }

    // Add custom field types
    for (const [field, type] of Object.entries(customFieldTypes)) {
      allFieldTypes.set(field, type);
    }

    // Get dataset configuration
    const datasetConfig = DATASET_CONFIGS[dataset] || DATASET_CONFIGS.spans;

    // Get recommended fields for this dataset
    const recommendedFields = RECOMMENDED_FIELDS[dataset];

    // Translate the natural language query using AI
    const parsed = await translateQuery(
      {
        naturalLanguageQuery: params.naturalLanguageQuery,
        dataset,
        organizationSlug,
        projectId,
        allFields,
        datasetConfig,
        recommendedFields,
      },
      apiService,
      organizationSlug,
      projectId,
    );

    // Handle AI errors first
    if (parsed.error) {
      throw new Error(
        `AI could not translate query "${params.naturalLanguageQuery}" for ${dataset} dataset. Error: ${parsed.error}. AI response: ${JSON.stringify(parsed, null, 2)}`,
      );
    }

    // Validate that sort parameter was provided
    if (!parsed.sort) {
      throw new Error(
        `AI response missing required 'sort' parameter. Received: ${JSON.stringify(parsed, null, 2)}. The AI must specify how to sort results (e.g., '-timestamp' for newest first, '-count()' for highest count).`,
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
        throw new Error(
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

    // Validate aggregate functions use appropriate field types
    if (isAggregateQuery) {
      const numericAggregateFunctions = [
        "avg",
        "sum",
        "min",
        "max",
        "p50",
        "p75",
        "p90",
        "p95",
        "p99",
        "p100",
      ];

      // Extract aggregate functions from fields array
      const aggregateFunctions = fields.filter(
        (field) => field.includes("(") && field.includes(")"),
      );

      for (const func of aggregateFunctions) {
        // Extract function name and field from patterns like "avg(span.duration)"
        const match = func.match(/^(\w+)\(([^)]+)\)$/);
        if (match) {
          const [, funcName, fieldName] = match;

          // Check if this is a numeric function
          if (numericAggregateFunctions.includes(funcName)) {
            // Check if the field is numeric
            const fieldType = allFieldTypes.get(fieldName);
            if (fieldType !== "number") {
              throw new Error(
                `Invalid aggregate function: ${func}. The ${funcName}() function requires a numeric field, but "${fieldName}" is ${fieldType ? `a ${fieldType} field` : "not a known numeric field"}. Use count() or count_unique() for non-numeric fields.`,
              );
            }
          }
        }
      }
    }

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

    const eventsResponse = await withApiErrorHandling(
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

    // Type-safe access to event data
    // Since searchEvents returns unknown, we need to safely access the data property
    const responseData = eventsResponse as { data?: unknown[] };
    const eventData = (responseData.data || []) as Record<string, unknown>[];

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
