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
import { hasAgentProvider } from "../../internal/agents/provider-factory";
import { ConfigurationError, UserInputError } from "../../errors";
import { searchEventsAgent } from "./agent";
import {
  formatErrorResults,
  formatLogResults,
  formatSpanResults,
} from "./formatters";
import { RECOMMENDED_FIELDS } from "./config";

export default defineTool({
  name: "search_events",
  skills: ["inspect", "triage", "seer"], // Available in inspect, triage, and seer skills
  requiredScopes: ["event:read"],
  description: [
    "Search for events AND perform counts/aggregations - the ONLY tool for statistics and counts.",
    "",
    "Provide `naturalLanguageQuery` to let an embedded agent determine dataset, query, fields, and sort,",
    "or provide these directly with Sentry search syntax.",
    "",
    "Supports TWO query types:",
    "1. AGGREGATIONS (counts, sums, averages): 'how many errors', 'total tokens'",
    "2. Individual events with timestamps: 'error logs from last hour'",
    "",
    "Datasets:",
    "- errors: Exception/crash events",
    "- logs: Log entries",
    "- spans: Performance data, traces, AI/LLM calls",
    "",
    "DO NOT USE for grouped issue lists → use search_issues",
    "",
    "<examples>",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='how many errors today')",
    "search_events(organizationSlug='my-org', dataset='errors', query='level:error')",
    "search_events(organizationSlug='my-org', dataset='errors', query='level:error', fields=['issue', 'count()'], sort='-count()')",
    "search_events(organizationSlug='my-org', dataset='spans', query='span.op:db', sort='-span.duration')",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, it's likely in the format of <organizationSlug>/<projectSlug>.",
    "- Parse org/project notation directly without calling find_organizations or find_projects.",
    "- Use fields with aggregate functions like count(), avg(), sum() for statistics",
    "- Sort by -count() for most common, -timestamp for newest",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Natural language description of what you want to search for. When provided, an embedded agent determines the dataset, query, fields, and sort.",
      ),
    dataset: z
      .enum(["errors", "logs", "spans"])
      .default("errors")
      .describe(
        "Dataset to query: errors (exceptions), logs, or spans (traces). Used when naturalLanguageQuery is not provided.",
      ),
    query: z
      .string()
      .trim()
      .default("")
      .describe(
        "Sentry event search query syntax. Used when naturalLanguageQuery is not provided.",
      ),
    fields: z
      .array(z.string())
      .nullable()
      .default(null)
      .describe(
        "Fields to return. If not specified, uses sensible defaults. Include aggregate functions like count(), avg() for statistics.",
      ),
    sort: z
      .string()
      .default("-timestamp")
      .describe(
        "Sort field (prefix with - for descending). Use -count() for aggregations.",
      ),
    projectSlug: ParamProjectSlug.nullable().default(null),
    statsPeriod: z
      .string()
      .default("14d")
      .describe(
        "Time period: 1h, 24h, 7d, 14d, 30d, etc. Used when naturalLanguageQuery is not provided.",
      ),
    regionUrl: ParamRegionUrl.nullable().default(null),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of results to return (1-100)"),
    includeExplanation: z
      .boolean()
      .default(false)
      .describe(
        "Include explanation of how the query was translated (only applies with naturalLanguageQuery)",
      ),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    if (params.projectSlug) setTag("project.slug", params.projectSlug);

    // Convert project slug to ID if needed
    let projectId: string | undefined;
    if (params.projectSlug) {
      const project = await apiService.getProject({
        organizationSlug,
        projectSlugOrId: params.projectSlug,
      });
      projectId = String(project.id);
    }

    let dataset: "errors" | "logs" | "spans";
    let sentryQuery: string;
    let fields: string[];
    let sortParam: string;
    let timeParams: { statsPeriod?: string; start?: string; end?: string };
    let explanation: string | undefined;

    if (params.naturalLanguageQuery) {
      // NL mode: use embedded agent to determine all params
      if (!hasAgentProvider()) {
        throw new ConfigurationError(
          "Natural language search requires an AI provider (OPENAI_API_KEY or ANTHROPIC_API_KEY). " +
            "Use the 'query', 'dataset', and 'fields' parameters with Sentry search syntax instead.",
        );
      }

      const agentResult = await searchEventsAgent({
        query: params.naturalLanguageQuery,
        organizationSlug,
        apiService,
        projectId,
      });

      const parsed = agentResult.result;
      dataset = parsed.dataset;
      sentryQuery = parsed.query || "";
      explanation = parsed.explanation;

      if (!parsed.sort) {
        throw new UserInputError(
          `Search Events Agent response missing required 'sort' parameter. Received: ${JSON.stringify(parsed, null, 2)}. The agent must specify how to sort results (e.g., '-timestamp' for newest first, '-count()' for highest count).`,
        );
      }
      sortParam = parsed.sort;

      const requestedFields = parsed.fields || [];
      const isAggregateQuery = requestedFields.some(
        (field) => field.includes("(") && field.includes(")"),
      );

      if (isAggregateQuery) {
        fields = requestedFields;
      } else {
        fields =
          requestedFields.length > 0
            ? requestedFields
            : RECOMMENDED_FIELDS[dataset].basic;
      }

      timeParams = parsed.timeRange
        ? { ...parsed.timeRange }
        : { statsPeriod: "14d" };
    } else {
      // Direct mode: use provided params as-is
      dataset = params.dataset;
      sentryQuery = params.query;
      fields = params.fields ?? RECOMMENDED_FIELDS[dataset].basic;
      sortParam = params.sort;
      timeParams = { statsPeriod: params.statsPeriod };
    }

    const eventsResponse = await apiService.searchEvents({
      organizationSlug,
      query: sentryQuery,
      fields,
      limit: params.limit,
      projectId,
      dataset,
      sort: sortParam,
      ...timeParams,
    });

    // Generate the Sentry explorer URL
    const aggregateFunctions = fields.filter(
      (field) => field.includes("(") && field.includes(")"),
    );
    const groupByFields = fields.filter(
      (field) => !field.includes("(") && !field.includes(")"),
    );

    const explorerUrl = apiService.getEventsExplorerUrl(
      organizationSlug,
      sentryQuery,
      projectId,
      dataset,
      fields,
      sortParam,
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

    const displayQuery =
      params.naturalLanguageQuery || params.query || `${dataset} events`;

    const formatParams = {
      eventData,
      naturalLanguageQuery: displayQuery,
      includeExplanation: params.includeExplanation,
      apiService,
      organizationSlug,
      explorerUrl,
      sentryQuery,
      fields,
      explanation,
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
