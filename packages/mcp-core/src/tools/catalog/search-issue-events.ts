import { z } from "zod";
import { getActiveSpan, setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { ensureIssueWithinProjectConstraint } from "../../internal/tool-helpers/issue";
import {
  createStructuredOutputSecurity,
  StructuredOutputSecuritySchema,
} from "../../internal/structured-output";
import {
  createStructuredToolResult,
  type StructuredToolResult,
} from "../../internal/tool-result";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../../schema";
import { hasAgentProvider } from "../../internal/agents/provider-factory";
import { UserInputError } from "../../errors";
import { searchIssueEventsAgent } from "../support/search-issue-events/agent";
import {
  createRenderedErrorEventRows,
  formatErrorResults,
  type FormatEventResultsParams,
} from "../support/search-events/formatters";
import { RECOMMENDED_FIELDS } from "../support/search-issue-events/config";
import { parseIssueParams } from "../support/search-issue-events/utils";

const SEARCH_ISSUE_EVENTS_STRUCTURED_CONTENT_VERSION =
  "sentry.mcp.search_issue_events.v1";

const searchIssueEventsStructuredOutputSchema = z.object({
  schemaVersion: z.literal(SEARCH_ISSUE_EVENTS_STRUCTURED_CONTENT_VERSION),
  security: StructuredOutputSecuritySchema,
  meta: z.object({
    organizationSlug: z.string(),
    issueIdentifier: z.string(),
    projectSlug: z.string().nullable(),
    projectId: z.string().nullable(),
  }),
  links: z.object({
    explorer: z.string(),
  }),
  issue: z.object({
    identifier: z.string(),
  }),
  search: z.object({
    inputQuery: z.string(),
    dataset: z.literal("errors"),
    query: z.string(),
    explorerQuery: z.string(),
    fields: z.array(z.string()),
    sort: z.string(),
    timeRange: z.object({
      statsPeriod: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
    }),
    limit: z.number(),
    explanation: z.string().nullable().optional(),
  }),
  results: z.object({
    kind: z.literal("issue_events"),
    count: z.number(),
    data: z.array(
      z.object({
        id: z.string().nullable(),
        title: z.string(),
        fields: z.array(
          z.object({
            name: z.string(),
            label: z.string(),
            value: z.string(),
          }),
        ),
      }),
    ),
  }),
});

interface SearchTimeRange {
  statsPeriod?: string;
  start?: string;
  end?: string;
}

type SearchIssueEventsFormatParams = FormatEventResultsParams & {
  issueIdentifier: string;
  query: string;
  sort: string;
  timeRange: SearchTimeRange;
  limit: number;
  projectSlug?: string | null;
  projectId?: string | null;
};

function formatSearchIssueEventsResult(
  params: SearchIssueEventsFormatParams,
  context: ServerContext,
): string | StructuredToolResult {
  if (!context.experimentalMode) {
    return formatErrorResults(params);
  }

  return createStructuredToolResult({
    schemaVersion: SEARCH_ISSUE_EVENTS_STRUCTURED_CONTENT_VERSION,
    security: createStructuredOutputSecurity(),
    meta: {
      organizationSlug: params.organizationSlug,
      issueIdentifier: params.issueIdentifier,
      projectSlug: params.projectSlug ?? null,
      projectId: params.projectId ?? null,
    },
    links: {
      explorer: params.explorerUrl,
    },
    issue: {
      identifier: params.issueIdentifier,
    },
    search: {
      inputQuery: params.inputQuery,
      dataset: "errors",
      query: params.query,
      explorerQuery: params.sentryQuery,
      fields: params.fields,
      sort: params.sort,
      timeRange: params.timeRange,
      limit: params.limit,
      ...(params.includeExplanation === true
        ? { explanation: params.explanation ?? null }
        : {}),
    },
    results: {
      kind: "issue_events",
      count: params.eventData.length,
      data: createRenderedErrorEventRows({
        eventData: params.eventData,
        apiService: params.apiService,
        organizationSlug: params.organizationSlug,
      }),
    },
  });
}

function buildIssueEventSearchRepairPrompt(params: {
  query?: string;
  sort?: string;
  statsPeriod?: string;
}): string {
  return [
    "Fix this Sentry issue event search request.",
    "The query may be natural language or already-valid Sentry event search syntax.",
    "Preserve valid explicit parameters, but correct query syntax, fields, sort, and time range when they conflict or would fail.",
    "",
    `User query: ${params.query || "(empty)"}`,
    "Current parameters:",
    JSON.stringify(
      {
        sort: params.sort ?? null,
        statsPeriod: params.statsPeriod ?? null,
      },
      null,
      2,
    ),
  ].join("\n");
}

export default defineTool({
  name: "search_issue_events",
  skills: ["inspect", "triage"], // Available in inspect and triage skills
  requiredScopes: ["event:read"],
  description: [
    "Search and filter events within a specific issue.",
    "",
    "Provide `query` as natural language or Sentry event search syntax. When an embedded agent is configured, it fixes filters, fields, sort, and time range before running.",
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
    "search_issue_events(issueId='MCP-41', organizationSlug='my-org', query='from last hour')",
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

    query: z
      .string()
      .trim()
      .optional()
      .describe(
        "Natural language or Sentry event search query syntax for filtering within the issue.",
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
      .describe("Initial time period hint: 1h, 24h, 7d, 14d, 30d, etc."),

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
        "Include explanation of how the query was translated or repaired",
      ),
  },
  outputSchema: ({ experimentalMode }) =>
    experimentalMode ? searchIssueEventsStructuredOutputSchema : undefined,
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
    const effectiveProjectSlug =
      params.projectSlug ?? context.constraints.projectSlug ?? null;
    if (effectiveProjectSlug) {
      setTag("project.slug", effectiveProjectSlug);
    }

    await ensureIssueWithinProjectConstraint({
      apiService,
      organizationSlug,
      issueId,
      projectSlug: context.constraints.projectSlug,
    });

    // Resolve project ID if project slug provided (for better tag discovery in NL mode)
    let projectId: string | undefined;
    if (effectiveProjectSlug) {
      try {
        const project = await apiService.getProject({
          organizationSlug,
          projectSlugOrId: effectiveProjectSlug,
        });
        projectId = String(project.id);
      } catch (error) {
        // Non-fatal - continue without project ID
        console.warn(
          `Could not resolve project ${effectiveProjectSlug}:`,
          error,
        );
      }
    }

    let query: string;
    let fields: string[];
    let sortParam: string;
    let timeParams: { statsPeriod?: string; start?: string; end?: string };
    let explanation: string | undefined;

    if (hasAgentProvider()) {
      // Agent mode: repair either natural language or already-structured params.
      const agentResult = await searchIssueEventsAgent({
        query: buildIssueEventSearchRepairPrompt({
          query: params.query,
          sort: params.sort,
          statsPeriod: params.statsPeriod,
        }),
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

    getActiveSpan()?.setAttribute(
      "gen_ai.tool.call.result.count",
      eventsResponse.length,
    );

    const naturalLanguageContext = params.query
      ? `Events in issue ${issueId}: ${params.query}`
      : `Events in issue ${issueId}`;

    return formatSearchIssueEventsResult(
      {
        eventData: eventsResponse,
        inputQuery: naturalLanguageContext,
        includeExplanation: params.includeExplanation,
        apiService,
        organizationSlug,
        explorerUrl,
        sentryQuery: explorerQuery,
        fields,
        explanation,
        issueIdentifier: issueId,
        query,
        sort: sortParam,
        timeRange: timeParams,
        limit: params.limit,
        projectSlug: effectiveProjectSlug,
        projectId: projectId ?? null,
      },
      context,
    );
  },
});
