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
import { searchIssueEventsAgent } from "./agent";
import { formatErrorResults } from "../search-events/formatters";
import { RECOMMENDED_FIELDS } from "./config";
import { UserInputError } from "../../errors";
import { parseIssueParams } from "./utils";

export default defineTool({
  name: "search_issue_events",
  skills: ["inspect", "triage"], // Available in inspect and triage skills
  requiredScopes: ["event:read"],
  description: [
    "Search and filter events within a specific issue using natural language queries.",
    "",
    "Use this to filter events by time, environment, release, user, trace ID, or other tags. The tool automatically constrains results to the specified issue.",
    "",
    "For cross-issue searches use search_issues, for single event details use get_issue_details.",
    "",
    "<examples>",
    "search_issue_events(issueId='MCP-41', organizationSlug='my-org', naturalLanguageQuery='from last hour')",
    "search_issue_events(issueUrl='https://sentry.io/.../issues/123/', naturalLanguageQuery='production with release v1.0')",
    "</examples>",
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
        "Issue ID (e.g., 'MCP-41', 'PROJECT-123'). Requires organizationSlug. Alternatively, use issueUrl.",
      ),
    issueUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Full Sentry issue URL (e.g., 'https://sentry.io/organizations/my-org/issues/123/'). Includes both organization and issue ID.",
      ),

    // Natural language query for filtering
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Natural language description of what events you want to find within this issue. Examples: 'from last hour', 'production with release v1.0', 'affecting user alice@example.com', 'with trace ID abc123'",
      ),

    // Optional context parameters
    projectSlug: ParamProjectSlug.nullable()
      .default(null)
      .describe(
        "Project slug for better tag discovery. Optional - helps find project-specific tags.",
      ),
    regionUrl: ParamRegionUrl.nullable()
      .default(null)
      .describe("Sentry region URL. Optional - defaults to main region."),

    // Output control
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of events to return (1-100, default: 50)"),
    includeExplanation: z
      .boolean()
      .default(false)
      .describe(
        "Include explanation of how the natural language query was translated to Sentry syntax",
      ),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // 1. Parse and validate issue parameters
    const { organizationSlug, issueId } = parseIssueParams({
      organizationSlug: params.organizationSlug,
      issueId: params.issueId,
      issueUrl: params.issueUrl,
    });

    // 2. Initialize API service with region support
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    // 3. Set monitoring tags for observability
    setTag("organization.slug", organizationSlug);
    setTag("issue.id", issueId);
    if (params.projectSlug) {
      setTag("project.slug", params.projectSlug);
    }

    // 4. Resolve project ID if project slug provided (for better tag discovery)
    let projectId: string | undefined;
    if (params.projectSlug) {
      try {
        const project = await apiService.getProject({
          organizationSlug,
          projectSlugOrId: params.projectSlug,
        });
        projectId = String(project.id);
      } catch (error) {
        // Non-fatal error - continue without project ID
        // Tag discovery will be less specific but still work
        console.warn(`Could not resolve project ${params.projectSlug}:`, error);
      }
    }

    // 5. Call embedded AI agent to translate natural language query
    // Agent will determine filters, fields, sort, and time range
    const agentResult = await searchIssueEventsAgent({
      query: params.naturalLanguageQuery,
      organizationSlug,
      apiService,
      projectId,
    });

    const parsed = agentResult.result;

    // 6. Validate that sort parameter was provided
    if (!parsed.sort) {
      throw new UserInputError(
        `Search Issue Events Agent response missing required 'sort' parameter. Received: ${JSON.stringify(parsed, null, 2)}. The agent must specify how to sort results (e.g., '-timestamp' for newest first).`,
      );
    }

    // 7. Extract query from agent response (no issue: prefix needed)
    // The listEventsForIssue endpoint already filters by issue ID
    const query = parsed.query || "";

    // 8. Extract fields and sort from agent response
    const requestedFields = parsed.fields || [];
    const fields =
      requestedFields.length > 0 ? requestedFields : RECOMMENDED_FIELDS;
    const sortParam = parsed.sort;

    // 9. Build time range parameters from agent response
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

    // 10. Execute search using issue-specific endpoint
    // This endpoint is already scoped to the issue, so we don't need to add issue: to the query
    const eventsResponse = await apiService.listEventsForIssue({
      organizationSlug,
      issueId,
      query,
      limit: params.limit,
      sort: sortParam,
      ...timeParams,
    });

    // 11. Generate Sentry explorer URL for user to view results in UI
    // For the explorer URL, we DO need to include issue: in the query
    const explorerQuery = query
      ? `issue:${issueId} ${query}`
      : `issue:${issueId}`;
    const explorerUrl = apiService.getEventsExplorerUrl(
      organizationSlug,
      explorerQuery,
      projectId,
      "errors", // dataset
      fields,
      sortParam,
      [], // No aggregate functions for individual event queries
      [], // No groupBy fields
      timeParams.statsPeriod,
      timeParams.start,
      timeParams.end,
    );

    // 12. Validate response structure
    // The /issues/:issueId/events/ endpoint returns an array directly, not wrapped in {data: [...]}
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

    const eventData = eventsResponse;

    // 13. Format results using shared error formatter from search-events
    const naturalLanguageContext = `Events in issue ${issueId}: ${params.naturalLanguageQuery}`;

    return formatErrorResults({
      eventData,
      naturalLanguageQuery: naturalLanguageContext,
      includeExplanation: params.includeExplanation,
      apiService,
      organizationSlug,
      explorerUrl,
      sentryQuery: explorerQuery,
      fields,
      explanation: parsed.explanation,
    });
  },
});
