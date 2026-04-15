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
import {
  formatErrorResults,
  formatLogResults,
  formatTraceMetricsResults,
  formatSpanResults,
} from "../search-events/formatters";
import {
  RECOMMENDED_FIELDS,
  TRACE_METRICS_SAMPLE_IDENTITY_FIELDS,
} from "../search-events/config";
import { isAggregateQuery } from "../search-events/utils";
import {
  isMetricsDataset,
  PUBLIC_EVENTS_DATASETS,
} from "../../utils/events-datasets";
import {
  DEFAULT_REPLAY_SORT,
  DEFAULT_REPLAY_STATS_PERIOD,
  formatReplayResults,
  isValidReplaySort,
} from "../search-events/replays";
import { UserInputError } from "../../errors";

const LIST_EVENTS_DATASETS = [...PUBLIC_EVENTS_DATASETS, "replays"] as const;
const DEFAULT_EVENTS_SORT = "-timestamp";

// Default fields for each dataset
const DEFAULT_FIELDS = {
  errors: RECOMMENDED_FIELDS.errors.basic,
  logs: RECOMMENDED_FIELDS.logs.basic,
  spans: RECOMMENDED_FIELDS.spans.basic,
  metrics: RECOMMENDED_FIELDS.tracemetrics.basic,
};

export default defineTool({
  name: "list_events",
  skills: ["inspect", "triage", "seer"],
  requiredScopes: ["event:read"],
  description: [
    "Search events or replays using Sentry query syntax directly (no AI/LLM required).",
    "",
    "Use this tool when:",
    "- You know Sentry query syntax already",
    "- AI-powered search is unavailable (no OPENAI_API_KEY or ANTHROPIC_API_KEY)",
    "- You want precise control over the query",
    "",
    "For natural language queries, use search_events instead.",
    "For dataset='replays', this tool returns replay sessions directly and does not support aggregate fields like count().",
    "",
    "Datasets:",
    "- errors: Exception/crash events",
    "- logs: Log entries",
    "- spans: Performance data, traces, AI/LLM calls",
    "- metrics: Newer span metrics, counters, gauges, and distributions",
    "- replays: Session replay results such as rage clicks, dead clicks, visited pages, and replay users",
    "",
    "Query Syntax Examples:",
    '- message:"connection timeout"',
    "- level:error",
    "- span.op:http.client span.status_code:500",
    "- log.level:error",
    "- transaction:/api/users",
    "",
    "<examples>",
    "list_events(organizationSlug='my-org', dataset='errors', query='level:error')",
    "list_events(organizationSlug='my-org', dataset='spans', query='span.op:db')",
    "list_events(organizationSlug='my-org', dataset='logs', query='severity:error')",
    "list_events(organizationSlug='my-org', dataset='errors', fields=['issue', 'count()'], sort='-count()')",
    "list_events(organizationSlug='my-org', dataset='replays', query='count_errors:>0', sort='-count_errors')",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, it's likely in the format of <organizationSlug>/<projectSlug>.",
    "- Use fields with aggregate functions like count(), avg(), sum() for statistics",
    "- Sort by -count() for most common, -timestamp for newest",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    dataset: z
      .enum(LIST_EVENTS_DATASETS)
      .default("errors")
      .describe(
        "Dataset to query: errors (exceptions), logs (entries), spans (traces), metrics (newer span metrics), or replays (session replay results)",
      ),
    query: z
      .string()
      .trim()
      .default("")
      .describe("Sentry event search query syntax (empty for all events)"),
    fields: z
      .array(z.string())
      .nullable()
      .default(null)
      .describe(
        "Fields to return for event datasets. If not specified, uses sensible defaults. Include aggregate functions like count(), avg() for statistics. Leave null for dataset='replays'.",
      ),
    sort: z
      .string()
      .trim()
      .nullable()
      .default(null)
      .describe(
        "Sort field (prefix with - for descending). If omitted, event datasets default to -timestamp and replays default to -started_at. Use -count() for event aggregations. For dataset='replays', use replay sorts like -started_at or -count_errors.",
      ),
    projectSlug: ParamProjectSlug.nullable().default(null),
    environment: z
      .union([
        z.string().trim().min(1),
        z.array(z.string().trim().min(1)).min(1),
      ])
      .nullable()
      .default(null)
      .describe(
        "Optional environment filter for dataset='replays'. Use a string for one environment or an array for multiple. For other datasets, filter environment in the query string instead.",
      ),
    statsPeriod: z
      .string()
      .default("14d")
      .describe("Time period: 1h, 24h, 7d, 14d, 30d, etc."),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of results to return (1-100)"),
    regionUrl: ParamRegionUrl.nullable().default(null),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    setTag("organization.slug", params.organizationSlug);
    if (params.projectSlug) setTag("project.slug", params.projectSlug);

    if (params.dataset !== "replays" && params.environment) {
      throw new UserInputError(
        "The `environment` parameter is only supported for dataset='replays'. For other datasets, include environment filtering in the query string instead.",
      );
    }

    // Convert project slug to ID if provided
    let projectId: string | undefined;
    if (params.projectSlug) {
      const project = await apiService.getProject({
        organizationSlug: params.organizationSlug,
        projectSlugOrId: params.projectSlug,
      });
      projectId = String(project.id);
    }

    if (params.dataset === "replays") {
      const replaySort = params.sort || DEFAULT_REPLAY_SORT;
      if (!isValidReplaySort(replaySort)) {
        throw new UserInputError(
          `Invalid replay sort "${replaySort}". Use a supported replay sort like ${DEFAULT_REPLAY_SORT}, -count_errors, -count_rage_clicks, or -duration.`,
        );
      }

      const replays = await apiService.searchReplays({
        organizationSlug: params.organizationSlug,
        query: params.query,
        limit: params.limit,
        projectId,
        sort: replaySort,
        environment: params.environment ?? undefined,
        statsPeriod: params.statsPeriod || DEFAULT_REPLAY_STATS_PERIOD,
      });

      const replaySearchUrl = apiService.getReplaysSearchUrl(
        params.organizationSlug,
        {
          query: params.query || undefined,
          projectSlugOrId: projectId,
          environment: params.environment ?? undefined,
          sort: replaySort,
          statsPeriod: params.statsPeriod || DEFAULT_REPLAY_STATS_PERIOD,
        },
      );

      return formatReplayResults({
        replays,
        naturalLanguageQuery: params.query || "recent replays",
        includeExplanation: false,
        organizationSlug: params.organizationSlug,
        apiService,
        searchUrl: replaySearchUrl,
        replayQuery: params.query,
        sort: replaySort,
        environment: params.environment,
        timeRange: {
          statsPeriod: params.statsPeriod || DEFAULT_REPLAY_STATS_PERIOD,
        },
      });
    }

    // Use provided fields or defaults for the dataset
    const sort = params.sort || DEFAULT_EVENTS_SORT;
    const fields = params.fields ?? DEFAULT_FIELDS[params.dataset];
    const requestFields =
      isMetricsDataset(params.dataset) && !isAggregateQuery(fields)
        ? Array.from(
            new Set([...fields, ...TRACE_METRICS_SAMPLE_IDENTITY_FIELDS]),
          )
        : fields;

    const eventsResponse = await apiService.searchEvents({
      organizationSlug: params.organizationSlug,
      query: params.query,
      fields: requestFields,
      limit: params.limit,
      projectId,
      dataset: params.dataset,
      sort,
      statsPeriod: params.statsPeriod,
    });

    // Type validation
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

    // Generate explorer URL
    const aggregateFunctions = fields.filter(
      (field) => field.includes("(") && field.includes(")"),
    );
    const groupByFields = fields.filter(
      (field) => !field.includes("(") && !field.includes(")"),
    );

    const explorerUrl = apiService.getEventsExplorerUrl(
      params.organizationSlug,
      params.query,
      projectId,
      params.dataset,
      fields,
      sort,
      aggregateFunctions,
      groupByFields,
      params.statsPeriod,
      undefined,
      undefined,
      eventData,
    );

    const formatParams = {
      eventData,
      naturalLanguageQuery: params.query || `${params.dataset} events`,
      includeExplanation: false,
      apiService,
      organizationSlug: params.organizationSlug,
      explorerUrl,
      sentryQuery: params.query,
      fields,
    };

    switch (params.dataset) {
      case "errors":
        return formatErrorResults(formatParams);
      case "logs":
        return formatLogResults(formatParams);
      case "spans":
        return formatSpanResults(formatParams);
      default:
        return formatTraceMetricsResults(formatParams);
    }
  },
});
