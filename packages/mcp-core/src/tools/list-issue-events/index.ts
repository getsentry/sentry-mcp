import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import { formatErrorResults } from "../search-events/formatters";
import { parseIssueParams } from "../search-issue-events/utils";
import { RECOMMENDED_FIELDS } from "../search-issue-events/config";

export default defineTool({
  name: "list_issue_events",
  skills: ["inspect", "triage"],
  requiredScopes: ["event:read"],
  description: [
    "List events within a specific issue using Sentry query syntax (no AI/LLM required).",
    "",
    "Use this tool when:",
    "- You know Sentry query syntax already",
    "- AI-powered search is unavailable (no OPENAI_API_KEY or ANTHROPIC_API_KEY)",
    "- You want precise control over the query",
    "",
    "For natural language queries, use search_issue_events instead.",
    "",
    "Common Query Filters:",
    "- environment:production - Filter by environment",
    "- release:1.0.0 - Filter by release version",
    "- user.email:alice@example.com - Filter by user email",
    "- timestamp:>2024-01-01 - Filter by timestamp",
    "",
    "<examples>",
    "list_issue_events(issueUrl='https://sentry.io/organizations/my-org/issues/123/', query='environment:production')",
    "list_issue_events(issueId='MCP-41', organizationSlug='my-org', query='release:v1.0.0')",
    "list_issue_events(issueId='PROJECT-123', organizationSlug='my-org', statsPeriod='1h')",
    "</examples>",
    "",
    "<hints>",
    "- Use issueUrl for convenience (includes org + issue ID)",
    "- Or provide both issueId and organizationSlug",
    "- The query filters events WITHIN the issue, no need for issue: prefix",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    // Issue identification - one method required
    organizationSlug: ParamOrganizationSlug.nullable()
      .default(null)
      .describe(
        "Organization slug. Required when using issueId. Not needed when using issueUrl.",
      ),
    issueId: z
      .string()
      .optional()
      .describe(
        "Issue ID (e.g., 'MCP-41', 'PROJECT-123'). Requires organizationSlug.",
      ),
    issueUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Full Sentry issue URL. Includes both organization and issue ID.",
      ),

    // Query parameters
    query: z
      .string()
      .trim()
      .default("")
      .describe("Sentry event search query syntax (empty for all events)"),
    sort: z
      .string()
      .default("-timestamp")
      .describe(
        "Sort field (prefix with - for descending). Default: -timestamp",
      ),
    statsPeriod: z
      .string()
      .default("14d")
      .describe("Time period: 1h, 24h, 7d, 14d, 30d, etc."),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of events to return (1-100)"),
    regionUrl: ParamRegionUrl.nullable().default(null),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // Parse and validate issue parameters
    const { organizationSlug, issueId } = parseIssueParams({
      organizationSlug: params.organizationSlug,
      issueId: params.issueId,
      issueUrl: params.issueUrl,
    });

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    setTag("organization.slug", organizationSlug);
    setTag("issue.id", issueId);

    // Execute search using issue-specific endpoint
    const eventsResponse = await apiService.listEventsForIssue({
      organizationSlug,
      issueId,
      query: params.query,
      limit: params.limit,
      sort: params.sort,
      statsPeriod: params.statsPeriod,
    });

    // Validate response structure
    function isValidEventArray(
      data: unknown,
    ): data is Record<string, unknown>[] {
      return (
        Array.isArray(data) &&
        data.every((item) => typeof item === "object" && item !== null)
      );
    }

    if (!isValidEventArray(eventsResponse)) {
      throw new Error(
        "Invalid event data format from Sentry API: expected array of objects",
      );
    }

    // Generate explorer URL (include issue: prefix for the explorer)
    const explorerQuery = params.query
      ? `issue:${issueId} ${params.query}`
      : `issue:${issueId}`;
    const explorerUrl = apiService.getEventsExplorerUrl(
      organizationSlug,
      explorerQuery,
      undefined, // projectId
      "errors",
      RECOMMENDED_FIELDS,
      params.sort,
      [],
      [],
      params.statsPeriod,
    );

    return formatErrorResults({
      eventData: eventsResponse,
      naturalLanguageQuery: `Events in issue ${issueId}`,
      includeExplanation: false,
      apiService,
      organizationSlug,
      explorerUrl,
      sentryQuery: explorerQuery,
      fields: RECOMMENDED_FIELDS,
    });
  },
});
