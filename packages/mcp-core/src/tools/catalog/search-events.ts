import { getActiveSpan, setTag, startSpan } from "@sentry/core";
import { z } from "zod";
import { UserInputError } from "../../errors";
import { hasAgentProvider } from "../../internal/agents/provider-factory";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { defineTool } from "../../internal/tool-helpers/define";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
  ParamRegionUrl,
} from "../../schema";
import type { ServerContext } from "../../types";
import {
  PUBLIC_EVENTS_DATASETS,
  type PublicEventsDataset,
  isMetricsDataset,
  normalizeEventsDataset,
} from "../../utils/events-datasets";
import {
  searchEventsAgent,
  type searchEventsAgentOutputSchema,
} from "../support/search-events/agent";
import {
  RECOMMENDED_FIELDS,
  TRACE_METRICS_SAMPLE_IDENTITY_FIELDS,
} from "../support/search-events/config";
import {
  formatErrorResults,
  formatLogResults,
  formatProfileResults,
  formatSpanResults,
  formatTraceMetricsResults,
} from "../support/search-events/formatters";
import {
  DEFAULT_REPLAY_SORT,
  DEFAULT_REPLAY_STATS_PERIOD,
  formatReplayResults,
  isValidReplaySort,
} from "../support/search-events/replays";
import {
  formatEventsValidationResults,
  isAggregateQuery,
  looksLikeSentrySearchSyntax,
  MAX_EVENTS_VALIDATION_ATTEMPTS,
  recordEventsSearchValidationTelemetry,
  validateEventsSearch,
} from "../support/search-events/utils";

const SEARCH_EVENTS_DATASETS = [...PUBLIC_EVENTS_DATASETS, "replays"] as const;
const DEFAULT_EVENTS_SORT = "-timestamp";

type SearchEventsAgentResult = z.output<typeof searchEventsAgentOutputSchema>;

type EventsSearchState = {
  dataset: PublicEventsDataset;
  sentryQuery: string;
  fields: string[];
  sortParam: string;
  environment?: string | string[] | null;
  timeParams: { statsPeriod?: string; start?: string; end?: string };
};

function defaultSortForDataset(dataset: PublicEventsDataset | "replays") {
  return dataset === "replays" ? DEFAULT_REPLAY_SORT : DEFAULT_EVENTS_SORT;
}

function defaultFieldsForDataset(dataset: PublicEventsDataset): string[] {
  return RECOMMENDED_FIELDS[normalizeEventsDataset(dataset)].basic;
}

function resolveEventFields({
  dataset,
  explicitFields,
  agentFields,
  trustExplicitFields,
}: {
  dataset: PublicEventsDataset;
  explicitFields?: string[] | null;
  agentFields?: string[];
  trustExplicitFields: boolean;
}): string[] {
  if (trustExplicitFields && explicitFields && explicitFields.length > 0) {
    return explicitFields;
  }
  if (agentFields && agentFields.length > 0) {
    return agentFields;
  }
  return defaultFieldsForDataset(dataset);
}

function parseAgentTimeRange(
  timeRange: unknown,
): { statsPeriod?: string; start?: string; end?: string } | undefined {
  if (typeof timeRange !== "object" || timeRange === null) {
    return undefined;
  }

  if ("statsPeriod" in timeRange && typeof timeRange.statsPeriod === "string") {
    return { statsPeriod: timeRange.statsPeriod };
  }
  if (
    "start" in timeRange &&
    "end" in timeRange &&
    typeof timeRange.start === "string" &&
    typeof timeRange.end === "string"
  ) {
    return { start: timeRange.start, end: timeRange.end };
  }

  return undefined;
}

function augmentFieldsWithSort(fields: string[], sort: string): string[] {
  const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
  const sortIsAggregate = sortField.includes("(") && sortField.includes(")");
  if (
    sortField &&
    !fields.includes(sortField) &&
    (sortIsAggregate || !isAggregateQuery(fields))
  ) {
    return [...fields, sortField];
  }
  return fields;
}

function buildRequestFields(
  dataset: PublicEventsDataset | "replays",
  fields: string[],
): string[] {
  return dataset !== "replays" &&
    isMetricsDataset(dataset) &&
    !isAggregateQuery(fields)
    ? Array.from(new Set([...fields, ...TRACE_METRICS_SAMPLE_IDENTITY_FIELDS]))
    : fields;
}

function applyValidationRepairFromAgent(
  state: EventsSearchState,
  parsed: SearchEventsAgentResult,
): EventsSearchState {
  const sortParam = parsed.sort.trim();
  const repairedFields =
    parsed.fields && parsed.fields.length > 0 ? parsed.fields : state.fields;
  return {
    dataset: parsed.dataset === "replays" ? state.dataset : parsed.dataset,
    sentryQuery: parsed.query || state.sentryQuery,
    fields: augmentFieldsWithSort(repairedFields, sortParam),
    sortParam,
    environment: parsed.environment ? parsed.environment : state.environment,
    timeParams: parseAgentTimeRange(parsed.timeRange) ?? state.timeParams,
  };
}

function isTraceItemDataset(dataset: PublicEventsDataset | "replays"): boolean {
  return dataset === "spans" || dataset === "logs" || dataset === "metrics";
}

function hasFields(fields?: string[] | null): fields is string[] {
  return Array.isArray(fields) && fields.length > 0;
}

function formatSearchValue(value: string): string {
  return /^[^\s"',[\]]+$/.test(value) ? value : JSON.stringify(value);
}

function formatEnvironmentFilter(
  environment?: string | string[] | null,
): string | undefined {
  if (!environment) {
    return undefined;
  }

  const environments = Array.isArray(environment) ? environment : [environment];
  if (environments.length === 0) {
    return undefined;
  }
  if (environments.length === 1) {
    const environmentValue = environments[0];
    return environmentValue === undefined
      ? undefined
      : `environment:${formatSearchValue(environmentValue)}`;
  }
  return `environment:[${environments.map(formatSearchValue).join(",")}]`;
}

function appendSearchFilter(query: string, filter?: string): string {
  const trimmedQuery = query.trim();
  if (!filter) {
    return trimmedQuery;
  }
  if (tokenizeSearchQuery(trimmedQuery).includes(filter)) {
    return trimmedQuery;
  }
  return [trimmedQuery, filter].filter(Boolean).join(" ");
}

function applyEnvironmentToEventsQuery(
  dataset: PublicEventsDataset | "replays",
  query: string,
  environment?: string | string[] | null,
): string {
  if (dataset === "replays") {
    return query;
  }
  return appendSearchFilter(query, formatEnvironmentFilter(environment));
}

function tokenizeSearchQuery(query: string): string[] {
  const tokens: string[] = [];
  let currentToken = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of query) {
    if (escaped) {
      currentToken += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      currentToken += char;
      escaped = true;
      continue;
    }

    if (quote) {
      currentToken += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      currentToken += char;
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = "";
      }
      continue;
    }

    currentToken += char;
  }

  if (currentToken) {
    tokens.push(currentToken);
  }

  return tokens;
}

function containsSearchToken(query: string, token: string): boolean {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escapedToken}(?=\\s|$)`).test(query);
}

function preservesSearchTokens(originalQuery: string, repairedQuery: string) {
  return tokenizeSearchQuery(originalQuery).every((token) =>
    containsSearchToken(repairedQuery, token),
  );
}

function choosePreservingRepairedQuery(params: {
  originalQuery: string;
  repairedQuery?: string | null;
  filter?: string;
}): string {
  const originalQuery = params.originalQuery.trim();
  const repairedQuery = params.repairedQuery?.trim();
  if (!repairedQuery) {
    return appendSearchFilter(originalQuery, params.filter);
  }

  if (!originalQuery || preservesSearchTokens(originalQuery, repairedQuery)) {
    return appendSearchFilter(repairedQuery, params.filter);
  }

  return appendSearchFilter(originalQuery, params.filter);
}

function buildSearchRepairPrompt(params: {
  query?: string;
  dataset: PublicEventsDataset | "replays";
  fields?: string[] | null;
  sort?: string | null;
  statsPeriod?: string;
  environment?: string | string[] | null;
}): string {
  return [
    "Fix this Sentry event search request.",
    "The query may be natural language or already-valid Sentry search syntax.",
    "Preserve valid explicit parameters, but correct dataset, query syntax, fields, sort, and time range when they conflict or would fail.",
    "If the user query already uses Sentry search syntax, treat its filters as authoritative unless the search validation step proves a field is invalid.",
    "For spans, logs, and metrics, use datasetAttributes to discover likely fields with substringMatch, query, and attributeTypes before dropping or renaming explicit fields.",
    "A broad datasetAttributes result may be truncated, so absence from that preview does not prove an explicit field is invalid.",
    "For non-replay datasets, convert environment parameters into query filters. For replays, keep environment in the separate environment parameter.",
    "",
    `User query: ${params.query || "(empty)"}`,
    "Current parameters:",
    JSON.stringify(
      {
        dataset: params.dataset,
        fields: params.fields ?? null,
        sort: params.sort ?? null,
        statsPeriod: params.statsPeriod ?? null,
        environment: params.environment ?? null,
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildValidationFailureRepairPrompt(params: {
  originalQuery?: string;
  dataset: PublicEventsDataset | "replays";
  query: string;
  fields: string[];
  sort: string;
  environment?: string | string[] | null;
  timeParams: { statsPeriod?: string; start?: string; end?: string };
  validation: string;
}): string {
  return [
    "Sentry events search validation failed. Repair the request so it passes validation.",
    "Use the validation results to correct every invalid parameter: dataset, environment, query filters, selected fields, sort, and time range.",
    "Use datasetAttributes to discover valid field names before renaming or replacing invalid fields.",
    "Prefer renaming invalid fields to valid attributes instead of dropping them.",
    "Ensure the sort field is included in the fields array.",
    "For non-replay datasets, convert environment filters into query syntax when validation rejects the environment parameter.",
    "For replays, keep environment in the separate environment parameter.",
    "",
    params.validation.trim(),
    "",
    `Original user query: ${params.originalQuery || "(empty)"}`,
    "Current request:",
    JSON.stringify(
      {
        dataset: params.dataset,
        query: params.query,
        fields: params.fields,
        sort: params.sort,
        environment: params.environment ?? null,
        ...params.timeParams,
      },
      null,
      2,
    ),
  ].join("\n");
}

export default defineTool({
  name: "search_events",
  skills: ["inspect", "triage", "seer"], // Available in inspect, triage, and seer skills
  requiredScopes: ["event:read"],
  description: [
    "Search Sentry events and replays. Use for event counts/statistics.",
    "",
    "`query` can be natural language or Sentry search syntax. With an agent configured, it fixes dataset, query, fields, and sort before running.",
    "",
    "Supports TWO query types:",
    "1. AGGREGATIONS (counts, sums, averages): 'how many errors', 'total tokens'",
    "2. Individual events with timestamps: 'error logs from last hour'",
    "",
    "Datasets:",
    "- errors: Exception/crash events with stack traces, usually grouped into issues",
    "- logs: Application log entries, including error-severity log messages",
    "- spans: Raw trace/span events for performance, AI/LLM calls, requests, and operations",
    "- metrics: Metric rows and aggregates: counters, gauges, distributions, values",
    "- profiles: Transaction/continuous profile results, profile IDs, profiled transactions",
    "- replays: Session replay results: rage clicks, dead clicks, visited pages, replay users",
    "If the user says logs, log messages, error logs, or warning logs, choose logs instead of errors.",
    "",
    "Replay searches return replay lists only; replay count()/avg()/sum() are not supported.",
    "",
    "NOT for grouped issue lists (use search_issues) or app screenshots/images (use get_latest_base_snapshot).",
    "",
    "<examples>",
    "search_events(organizationSlug='my-org', query='how many errors today')",
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
    dataset: z
      .enum(SEARCH_EVENTS_DATASETS)
      .optional()
      .describe(
        "Initial dataset hint: errors, logs, spans, metrics, profiles, or replays. The agent may correct this when configured.",
      ),
    query: z
      .string()
      .trim()
      .optional()
      .describe("Natural language or Sentry event search query syntax."),
    fields: z
      .array(z.string())
      .nullable()
      .optional()
      .describe(
        "Fields to return for event datasets. If not specified, uses sensible defaults. Include aggregate functions like count(), avg() for statistics. Leave null for dataset='replays'.",
      ),
    sort: z
      .string()
      .trim()
      .nullable()
      .optional()
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
      .optional()
      .describe(
        "Optional environment filter for dataset='replays'. Use a string for one environment or an array for multiple. For other datasets, filter environment in the query string instead.",
      ),
    period: z
      .string()
      .optional()
      .describe("Initial time period hint: 1h, 24h, 7d, 14d, 30d, etc."),
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
        "Include explanation of how the query was translated or repaired",
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

    const inputDataset = params.dataset ?? "errors";
    const hasStructuredQuery = looksLikeSentrySearchSyntax(params.query);
    const canApplyEnvironmentFilter =
      inputDataset !== "replays" &&
      isTraceItemDataset(inputDataset) &&
      hasStructuredQuery;

    if (
      !hasAgentProvider() &&
      inputDataset !== "replays" &&
      params.environment &&
      !canApplyEnvironmentFilter
    ) {
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
    let environment: string | string[] | null | undefined = params.environment;

    const explicitSort = params.sort?.trim() || undefined;
    const hasExplicitDataset = params.dataset !== undefined;
    const hasExplicitFields = hasFields(params.fields);
    const hasExplicitSort = explicitSort !== undefined;
    const hasExplicitPeriod = params.period !== undefined;
    const hasExplicitTraceItemDataset =
      hasExplicitDataset && isTraceItemDataset(inputDataset);
    const shouldTrustStructuredTraceSearch =
      hasStructuredQuery && hasExplicitTraceItemDataset;
    const environmentFilter = formatEnvironmentFilter(params.environment);
    const explicitStructuredTraceQuery = shouldTrustStructuredTraceSearch
      ? appendSearchFilter(params.query ?? "", environmentFilter)
      : (params.query ?? "");
    const canRunWithoutAgent =
      shouldTrustStructuredTraceSearch && hasExplicitFields && hasExplicitSort;

    if (hasAgentProvider() && !canRunWithoutAgent) {
      const agentResult = await searchEventsAgent({
        query: buildSearchRepairPrompt({
          query: params.query,
          dataset: inputDataset,
          fields: params.fields,
          sort: params.sort,
          statsPeriod: params.period,
          environment: params.environment,
        }),
        organizationSlug,
        apiService,
        projectId,
      });

      const parsed = agentResult.result;
      const shouldTrustExplicitSearchParams =
        shouldTrustStructuredTraceSearch ||
        (hasStructuredQuery && parsed.dataset === inputDataset);

      if (
        !parsed.sort?.trim() &&
        !(shouldTrustExplicitSearchParams && hasExplicitSort)
      ) {
        throw new UserInputError(
          `Search Events Agent response missing required 'sort' parameter. Received: ${JSON.stringify(parsed, null, 2)}. The agent must specify how to sort results (e.g., '-timestamp' for newest first).`,
        );
      }

      dataset = shouldTrustStructuredTraceSearch
        ? inputDataset
        : parsed.dataset;
      sentryQuery = shouldTrustStructuredTraceSearch
        ? choosePreservingRepairedQuery({
            originalQuery: params.query ?? "",
            repairedQuery: parsed.query,
            filter: environmentFilter,
          })
        : parsed.query || "";
      sortParam =
        shouldTrustExplicitSearchParams && explicitSort
          ? explicitSort
          : parsed.sort?.trim() || defaultSortForDataset(dataset);
      explanation = parsed.explanation;
      environment = params.environment ?? parsed.environment;

      timeParams =
        shouldTrustExplicitSearchParams && hasExplicitPeriod
          ? { statsPeriod: params.period }
          : (parseAgentTimeRange(parsed.timeRange) ?? { statsPeriod: "14d" });

      if (dataset === "replays") {
        fields = [];
      } else {
        fields = resolveEventFields({
          dataset,
          explicitFields: params.fields,
          agentFields: parsed.fields,
          trustExplicitFields: shouldTrustExplicitSearchParams,
        });
      }
    } else {
      dataset = inputDataset;
      sentryQuery = shouldTrustStructuredTraceSearch
        ? explicitStructuredTraceQuery
        : (params.query ?? "");
      sortParam = explicitSort || defaultSortForDataset(dataset);
      timeParams = { statsPeriod: params.period ?? "14d" };
      fields =
        dataset === "replays"
          ? []
          : (params.fields ?? defaultFieldsForDataset(dataset));
    }

    if (dataset === "replays") {
      const replaySort = sortParam || DEFAULT_REPLAY_SORT;
      if (!isValidReplaySort(replaySort)) {
        throw new UserInputError(
          `Invalid replay sort "${replaySort}". Use a supported replay sort like ${DEFAULT_REPLAY_SORT}, -count_errors, -count_rage_clicks, or -duration.`,
        );
      }

      const replayTimeParams: {
        statsPeriod?: string;
        start?: string;
        end?: string;
      } = { ...timeParams };
      if (
        !replayTimeParams.statsPeriod &&
        !replayTimeParams.start &&
        !replayTimeParams.end
      ) {
        replayTimeParams.statsPeriod = DEFAULT_REPLAY_STATS_PERIOD;
      }

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

      getActiveSpan()?.setAttribute(
        "gen_ai.tool.call.result.count",
        replays.length,
      );

      return formatReplayResults({
        replays,
        inputQuery: params.query || sentryQuery || "recent replays",
        includeExplanation: params.includeExplanation,
        organizationSlug,
        apiService,
        searchUrl: replaySearchUrl,
        replayQuery: sentryQuery,
        sort: replaySort,
        environment,
        explanation,
        timeRange: replayTimeParams,
        executedSearch: {
          dataset,
          query: sentryQuery,
          fields: [],
          sort: replaySort,
          timeRange: replayTimeParams,
        },
        experimentalMode: context.experimentalMode ?? false,
        availableToolNames: context.availableToolNames,
        directToolNames: context.directToolNames,
      });
    }

    // Sentry rejects the request if the sort column isn't in the selected
    // fields. The embedded agent's schema enforces this, but the handler can
    // recombine the caller's explicit fields with a default or explicit sort
    // that the agent never saw — so re-check here.
    //
    // Skip the augment when the sort is non-aggregate but the existing fields
    // are aggregate: adding a non-aggregate column to an aggregate query
    // changes the GROUP BY and silently corrupts the result. Better to let
    // Sentry's 400 propagate so the caller can fix the request explicitly.
    //
    // Note: fields and sortParam use the same function syntax sent to the API.
    fields = augmentFieldsWithSort(fields, sortParam);

    const requestFields = buildRequestFields(dataset, fields);

    let validationExplanation: string | undefined;
    sentryQuery = applyEnvironmentToEventsQuery(
      dataset,
      sentryQuery,
      environment,
    );
    let lastValidation = await validateEventsSearch(apiService, {
      organizationSlug,
      dataset,
      fields: requestFields,
      query: sentryQuery,
      sort: sortParam,
      projectId,
      environment: environment ?? undefined,
      ...timeParams,
    });
    recordEventsSearchValidationTelemetry({
      attempt: 0,
      validation: lastValidation,
    });

    if (!lastValidation.valid) {
      if (!hasAgentProvider()) {
        const formatted = formatEventsValidationResults(lastValidation);
        throw new UserInputError(
          formatted
            ? `Search validation failed:\n${formatted}`
            : "Search validation failed.",
        );
      }

      for (
        let attempt = 0;
        attempt < MAX_EVENTS_VALIDATION_ATTEMPTS && !lastValidation.valid;
        attempt++
      ) {
        await startSpan(
          {
            name: "search_events.validation_repair",
            op: "gen_ai.embedded_agent",
            attributes: {
              "app.search_events.validation.repair_iteration": attempt + 1,
            },
          },
          async () => {
            const agentResult = await searchEventsAgent({
              query: buildValidationFailureRepairPrompt({
                originalQuery: params.query,
                dataset,
                query: sentryQuery,
                fields,
                sort: sortParam,
                environment,
                timeParams,
                validation: formatEventsValidationResults(lastValidation),
              }),
              organizationSlug,
              apiService,
              projectId,
            });

            const parsed = agentResult.result;
            if (!parsed.sort?.trim()) {
              throw new UserInputError(
                `Search validation repair failed: agent response missing required 'sort' parameter. Received: ${JSON.stringify(parsed, null, 2)}.`,
              );
            }

            ({
              dataset,
              sentryQuery,
              fields,
              sortParam,
              environment,
              timeParams,
            } = applyValidationRepairFromAgent(
              {
                dataset: dataset as PublicEventsDataset,
                sentryQuery,
                fields,
                sortParam,
                environment,
                timeParams,
              },
              parsed,
            ));
            validationExplanation = parsed.explanation || validationExplanation;
            sentryQuery = applyEnvironmentToEventsQuery(
              dataset,
              sentryQuery,
              environment,
            );

            lastValidation = await validateEventsSearch(apiService, {
              organizationSlug,
              dataset,
              fields: buildRequestFields(dataset, fields),
              query: sentryQuery,
              sort: sortParam,
              projectId,
              environment: environment ?? undefined,
              ...timeParams,
            });
            recordEventsSearchValidationTelemetry({
              attempt: attempt + 1,
              repairIteration: attempt + 1,
              validation: lastValidation,
            });
          },
        );
      }

      if (!lastValidation.valid) {
        const formatted = formatEventsValidationResults(lastValidation);
        throw new UserInputError(
          formatted
            ? `Search validation failed after repair attempts:\n${formatted}`
            : "Search validation failed after repair attempts.",
        );
      }

      if (validationExplanation) {
        explanation = explanation
          ? `${explanation} ${validationExplanation}`
          : validationExplanation;
      }
    }

    const finalRequestFields = buildRequestFields(dataset, fields);
    sentryQuery = applyEnvironmentToEventsQuery(
      dataset,
      sentryQuery,
      environment,
    );

    const eventsResponse = await apiService.searchEvents({
      organizationSlug,
      query: sentryQuery,
      fields: finalRequestFields,
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

    getActiveSpan()?.setAttribute(
      "gen_ai.tool.call.result.count",
      eventData.length,
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
      eventData,
    );

    const formatParams = {
      eventData,
      inputQuery: params.query || sentryQuery || `${dataset} events`,
      includeExplanation: params.includeExplanation,
      apiService,
      organizationSlug,
      explorerUrl,
      sentryQuery,
      fields,
      explanation,
      executedSearch: {
        dataset,
        query: sentryQuery,
        fields,
        sort: sortParam,
        timeRange: timeParams,
      },
      experimentalMode: context.experimentalMode ?? false,
      availableToolNames: context.availableToolNames,
      directToolNames: context.directToolNames,
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
