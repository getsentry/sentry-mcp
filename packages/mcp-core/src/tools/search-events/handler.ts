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
  formatProfileResults,
  formatTraceMetricsResults,
  formatSpanResults,
} from "./formatters";
import {
  RECOMMENDED_FIELDS,
  TRACE_METRICS_SAMPLE_IDENTITY_FIELDS,
} from "./config";
import {
  isMetricsDataset,
  normalizeEventsDataset,
  PUBLIC_EVENTS_DATASETS,
  type PublicEventsDataset,
} from "../../utils/events-datasets";
import { isAggregateQuery } from "./utils";
import {
  DEFAULT_REPLAY_SORT,
  DEFAULT_REPLAY_STATS_PERIOD,
  formatReplayResults,
  isValidReplaySort,
} from "./replays";

const SEARCH_EVENTS_DATASETS = [...PUBLIC_EVENTS_DATASETS, "replays"] as const;
const DEFAULT_EVENTS_SORT = "-timestamp";

export default defineTool({
  name: "search_events",
  skills: ["inspect", "triage", "seer"], // Available in inspect, triage, and seer skills
  requiredScopes: ["event:read"],
  description: [
    "Search Sentry events and replays. This is the ONLY tool for counts/statistics on event datasets.",
    "",
    "Provide `naturalLanguageQuery` to let an embedded agent determine dataset, query, fields, and sort,",
    "or provide these directly with Sentry search syntax.",
    "",
    "Supports TWO query types:",
    "1. AGGREGATIONS (counts, sums, averages): 'how many errors', 'total tokens'",
    "2. Individual events with timestamps: 'error logs from last hour'",
    "",
    "Datasets:",
    "- errors: Exception/crash events with stack traces, usually grouped into issues",
    "- logs: Application log entries, including error-severity log messages",
    "- spans: Raw trace/span events for performance, AI/LLM calls, requests, and operations",
    "- metrics: Metric rows and aggregates, including counters, gauges, distributions, and metric values",
    "- profiles: Transaction and continuous profile results, profile IDs, and profiled transactions",
    "- replays: Session replay results such as rage clicks, dead clicks, visited pages, and replay users",
    "If the user says logs, log messages, error logs, or warning logs, choose logs instead of errors.",
    "",
    "Replay searches on this tool return replay lists only. Replay count()/avg()/sum() aggregations are not supported.",
    "",
    "DO NOT USE for grouped issue lists → use search_issues",
    "",
    "<examples>",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='how many errors today')",
    "search_events(organizationSlug='my-org', dataset='errors', query='level:error')",
    "search_events(organizationSlug='my-org', dataset='errors', fields=['issue', 'count()'], sort='-count()')",
    "search_events(organizationSlug='my-org', dataset='spans', query='span.op:db', sort='-span.duration')",
    "search_events(organizationSlug='my-org', dataset='replays', query='count_errors:>0', sort='-count_errors')",
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
      .enum(SEARCH_EVENTS_DATASETS)
      .default("errors")
      .describe(
        "Dataset to query when naturalLanguageQuery is not provided: errors, logs, spans, metrics, profiles, or replays.",
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

    if (!params.naturalLanguageQuery && params.dataset !== "replays" && params.environment) {
      throw new UserInputError(
        "The `environment` parameter is only supported for dataset='replays'. For other datasets, include environment filtering in the query string instead.",
      );
    }

    let projectId: string | undefined;
    if (params.projectSlug) {
      const project = await apiService.getProject({
        organizationSlug,
        projectSlugOrId: params.projectSlug,
      });
      projectId = String(project.id);
    }

    let dataset: PublicEventsDataset | "replays";
    let sentryQuery: string;
    let fields: string[];
    let sortParam: string;
    let timeParams: { statsPeriod?: string; start?: string; end?: string };
    let explanation: string | undefined;
    let environment:
      | string
      | string[]
      | null
      | undefined = params.environment;

    if (params.naturalLanguageQuery) {
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
      sortParam = parsed.sort;
      explanation = parsed.explanation;
      environment = parsed.environment;

      timeParams = {};
      if (parsed.timeRange) {
        if ("statsPeriod" in parsed.timeRange) {
          timeParams.statsPeriod = parsed.timeRange.statsPeriod;
        } else if ("start" in parsed.timeRange && "end" in parsed.timeRange) {
          timeParams.start = parsed.timeRange.start;
          timeParams.end = parsed.timeRange.end;
        }
      } else {
        timeParams.statsPeriod = "14d";
      }

      if (dataset === "replays") {
        fields = [];
      } else {
        const requestedFields = parsed.fields || [];
        const isAggregateFieldSelection = isAggregateQuery(requestedFields);
        if (isAggregateFieldSelection && requestedFields.length === 0) {
          throw new UserInputError(
            "AI response missing required 'fields' for aggregate query. For aggregate queries, include only aggregate functions and groupBy fields.",
          );
        }
        fields =
          requestedFields.length > 0
            ? requestedFields
            : RECOMMENDED_FIELDS[normalizeEventsDataset(dataset)].basic;
      }
    } else {
      dataset = params.dataset;
      sentryQuery = params.query;
      sortParam = params.sort || DEFAULT_EVENTS_SORT;
      timeParams = { statsPeriod: params.statsPeriod };
      fields =
        dataset === "replays"
          ? []
          : (params.fields ??
            RECOMMENDED_FIELDS[normalizeEventsDataset(dataset)].basic);
    }

    if (dataset === "replays") {
      const replaySort = sortParam || DEFAULT_REPLAY_SORT;
      if (!isValidReplaySort(replaySort)) {
        throw new UserInputError(
          `Invalid replay sort "${replaySort}". Use a supported replay sort like ${DEFAULT_REPLAY_SORT}, -count_errors, -count_rage_clicks, or -duration.`,
        );
      }

      const replayTimeParams = {
        statsPeriod: timeParams.statsPeriod ?? DEFAULT_REPLAY_STATS_PERIOD,
        start: timeParams.start,
        end: timeParams.end,
      };

      const replays = await apiService.searchReplays({
        organizationSlug,
        query: sentryQuery,
        limit: params.limit,
        projectId,
        sort: replaySort,
        environment: environment ?? undefined,
        ...replayTimeParams,
      });

      const replaySearchUrl = apiService.getReplaysSearchUrl(organizationSlug, {
        query: sentryQuery || undefined,
        projectSlugOrId: projectId,
        environment: environment ?? undefined,
        sort: replaySort,
        ...replayTimeParams,
      });

      return formatReplayResults({
        replays,
        naturalLanguageQuery:
          params.naturalLanguageQuery || sentryQuery || "recent replays",
        includeExplanation: params.includeExplanation,
        organizationSlug,
        apiService,
        searchUrl: replaySearchUrl,
        replayQuery: sentryQuery,
        sort: replaySort,
        environment,
        explanation,
        timeRange: replayTimeParams,
      });
    }

    const requestFields =
      isMetricsDataset(dataset) && !isAggregateQuery(fields)
        ? Array.from(
            new Set([...fields, ...TRACE_METRICS_SAMPLE_IDENTITY_FIELDS]),
          )
        : fields;

    const eventsResponse = await apiService.searchEvents({
      organizationSlug,
      query: sentryQuery,
      fields: requestFields,
      limit: params.limit,
      projectId,
      dataset,
      sort: sortParam,
      ...timeParams,
    });

    const aggregateFunctions = fields.filter(
      (field) => field.includes("(") && field.includes(")"),
    );
    const groupByFields = fields.filter(
      (field) => !field.includes("(") && !field.includes(")"),
    );

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
      eventData,
    );

    const formatParams = {
      eventData,
      naturalLanguageQuery:
        params.naturalLanguageQuery || sentryQuery || `${dataset} events`,
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
      case "profiles":
        return formatProfileResults(formatParams);
      default:
        return formatTraceMetricsResults(formatParams);
    }
  },
});
