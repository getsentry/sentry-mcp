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
  formatSpanResults,
} from "../search-events/formatters";
import { RECOMMENDED_FIELDS } from "../search-events/config";

// Default fields for each dataset
const DEFAULT_FIELDS = {
  errors: RECOMMENDED_FIELDS.errors.basic,
  logs: RECOMMENDED_FIELDS.logs.basic,
  spans: RECOMMENDED_FIELDS.spans.basic,
};

export default defineTool({
  name: "list_events",
  skills: ["inspect", "triage", "seer"],
  requiredScopes: ["event:read"],
  description: [
    "Search events using Sentry query syntax directly (no AI/LLM required).",
    "",
    "Use this tool when:",
    "- You know Sentry query syntax already",
    "- AI-powered search is unavailable (no OPENAI_API_KEY or ANTHROPIC_API_KEY)",
    "- You want precise control over the query",
    "",
    "For natural language queries, use search_events instead.",
    "",
    "Datasets:",
    "- errors: Exception/crash events",
    "- logs: Log entries",
    "- spans: Performance data, traces, AI/LLM calls",
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
      .enum(["errors", "logs", "spans"])
      .default("errors")
      .describe(
        "Dataset to query: errors (exceptions), logs, or spans (traces)",
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

    // Convert project slug to ID if provided
    let projectId: string | undefined;
    if (params.projectSlug) {
      const project = await apiService.getProject({
        organizationSlug: params.organizationSlug,
        projectSlugOrId: params.projectSlug,
      });
      projectId = String(project.id);
    }

    // Use provided fields or defaults for the dataset
    const fields = params.fields ?? DEFAULT_FIELDS[params.dataset];

    const eventsResponse = await apiService.searchEvents({
      organizationSlug: params.organizationSlug,
      query: params.query,
      fields,
      limit: params.limit,
      projectId,
      dataset: params.dataset,
      sort: params.sort,
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
      params.sort,
      aggregateFunctions,
      groupByFields,
      params.statsPeriod,
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
    }
  },
});
