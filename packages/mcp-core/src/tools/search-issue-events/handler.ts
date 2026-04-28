import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { ensureIssueWithinProjectConstraint } from "../../internal/tool-helpers/issue";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../../schema";
import { hasAgentProvider } from "../../internal/agents/provider-factory";
import { ConfigurationError, UserInputError } from "../../errors";
import { searchIssueEventsAgent } from "./agent";
import { formatErrorResults } from "../search-events/formatters";
import { RECOMMENDED_FIELDS } from "./config";
import { parseIssueParams } from "./utils";

export default defineTool({
  name: "search_issue_events",
  skills: ["inspect", "triage"], // Available in inspect and triage skills
  requiredScopes: ["event:read"],
  description: [
    "Search and filter events within a specific issue.",
    "",
    "Provide `naturalLanguageQuery` to let an embedded agent determine the correct filters,",
    "or use `query` and `sort` directly with Sentry search syntax.",
    "",
    "The tool automatically constrains results to the specified issue.",
    "",
    "Common Query Filters:",
    "- environment:production - Filter by environment",
    "- release:1.0.0 - Filter by release version",
    "- user.email:alice@example.com - Filter by user",
    "- trace:TRACE_ID - Filter by trace ID",
    "",
    "For cross-issue searches use search_issues. For single issue or event details use get_sentry_resource.",
    "",
    "<examples>",
    "search_issue_events(issueId='MCP-41', organizationSlug='my-org', naturalLanguageQuery='from last hour')",
    "search_issue_events(issueId='MCP-41', organizationSlug='my-org', query='environment:production')",
    "search_issue_events(issueUrl='https://sentry.io/.../issues/123/', query='release:v1.0.0', statsPeriod='7d')",
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

    // Natural language query for filtering (optional)
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Natural language description of what events to find within this issue. When provided, an embedded agent determines the correct filters, fields, sort, and time range.",
      ),

    // Direct Sentry syntax parameters
    query: z
      .string()
      .trim()
      .optional()
      .describe(
        "Sentry event search query syntax for filtering within the issue. Used when naturalLanguageQuery is not provided.",
      ),
    sort: z
      .string()
      .optional()
      .describe(
        "Sort field (prefix with - for descending). Default: -timestamp",
      ),
    statsPeriod: z
      .string()
      .optional()
      .describe(
        "Time period: 1h, 24h, 7d, 14d, 30d, etc. Used when naturalLanguageQuery is not provided.",
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
        "Include explanation of how the query was translated (only applies with naturalLanguageQuery)",
      ),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
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
    if (params.projectSlug) {
      setTag("project.slug", params.projectSlug);
    }

    await ensureIssueWithinProjectConstraint({
      apiService,
      organizationSlug,
      issueId,
      projectSlug: context.constraints.projectSlug,
    });

    // Resolve project ID if project slug provided (for better tag discovery in NL mode)
    let projectId: string | undefined;
    if (params.projectSlug) {
      try {
        const project = await apiService.getProject({
          organizationSlug,
          projectSlugOrId: params.projectSlug,
        });
        projectId = String(project.id);
      } catch (error) {
        // Non-fatal - continue without project ID
        console.warn(`Could not resolve project ${params.projectSlug}:`, error);
      }
    }

    let query: string;
    let fields: string[];
    let sortParam: string;
    let timeParams: { statsPeriod?: string; start?: string; end?: string };
    let explanation: string | undefined;

    if (params.naturalLanguageQuery) {
      // NL mode: use embedded agent to determine filters
      if (!hasAgentProvider()) {
        throw new ConfigurationError(
          "Natural language search requires an AI provider (OPENAI_API_KEY or ANTHROPIC_API_KEY). " +
            "Use the 'query' parameter with Sentry search syntax instead.",
        );
      }

      const agentResult = await searchIssueEventsAgent({
        query: params.naturalLanguageQuery,
        organizationSlug,
        apiService,
        projectId,
      });

      const parsed = agentResult.result;

      if (!parsed.sort) {
        throw new UserInputError(
          `Search Issue Events Agent response missing required 'sort' parameter. Received: ${JSON.stringify(parsed, null, 2)}. The agent must specify how to sort results (e.g., '-timestamp' for newest first).`,
        );
      }

      query = parsed.query || "";
      sortParam = parsed.sort;
      explanation = parsed.explanation;

      const requestedFields = parsed.fields || [];
      fields =
        requestedFields.length > 0 ? requestedFields : RECOMMENDED_FIELDS;

      timeParams = parsed.timeRange
        ? { ...parsed.timeRange }
        : { statsPeriod: "14d" };
    } else {
      // Direct mode: use provided params as-is
      query = params.query ?? "";
      fields = RECOMMENDED_FIELDS;
      sortParam = params.sort ?? "-timestamp";
      timeParams = { statsPeriod: params.statsPeriod ?? "14d" };
    }

    // Execute search using issue-specific endpoint
    const eventsResponse = await apiService.listEventsForIssue({
      organizationSlug,
      issueId,
      query,
      limit: params.limit,
      sort: sortParam,
      ...timeParams,
    });

    // Generate explorer URL (include issue: prefix for the explorer)
    const explorerQuery = query
      ? `issue:${issueId} ${query}`
      : `issue:${issueId}`;
    const explorerUrl = apiService.getEventsExplorerUrl(
      organizationSlug,
      explorerQuery,
      projectId,
      "errors",
      fields,
      sortParam,
      [],
      [],
      timeParams.statsPeriod,
      timeParams.start,
      timeParams.end,
    );

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

    const naturalLanguageContext = params.naturalLanguageQuery
      ? `Events in issue ${issueId}: ${params.naturalLanguageQuery}`
      : `Events in issue ${issueId}`;

    return formatErrorResults({
      eventData: eventsResponse,
      naturalLanguageQuery: naturalLanguageContext,
      includeExplanation: params.includeExplanation,
      apiService,
      organizationSlug,
      explorerUrl,
      sentryQuery: explorerQuery,
      fields,
      explanation,
    });
  },
});
