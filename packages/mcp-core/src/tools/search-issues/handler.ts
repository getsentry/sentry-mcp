import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import { validateSlugOrId, isNumericId } from "../../utils/slug-validation";
import { hasAgentProvider } from "../../internal/agents/provider-factory";
import { searchIssuesAgent } from "./agent";
import { formatIssueResults, formatExplanation } from "./formatters";

function buildIssueSearchRepairPrompt(params: {
  query: string;
  sort: "date" | "freq" | "new" | "user";
}): string {
  return [
    "Fix this Sentry issue search request.",
    "The query may be natural language or already-valid Sentry issue search syntax.",
    "Preserve valid explicit parameters, but correct query syntax and sort when they conflict or would fail.",
    "",
    `User query: ${params.query}`,
    "Current parameters:",
    JSON.stringify({ sort: params.sort }, null, 2),
  ].join("\n");
}

export default defineTool({
  name: "search_issues",
  skills: ["inspect", "triage", "seer"], // Available in inspect, triage, and seer skills
  requiredScopes: ["event:read"],
  description: [
    "Search for grouped issues/problems in Sentry - returns a LIST of issues, NOT counts or aggregations.",
    "",
    "Provide `query` as natural language or Sentry issue search syntax. When an embedded agent is configured, it fixes query and sort before running.",
    "",
    "Returns grouped issues with metadata like title, status, and user count.",
    "",
    "Common Query Syntax:",
    "- is:unresolved / is:resolved / is:ignored",
    "- level:error / level:warning",
    "- firstSeen:-24h / lastSeen:-7d",
    "- assigned:me / assignedOrSuggested:me",
    "- issueCategory:feedback",
    "- environment:production",
    "- userCount:>100",
    "",
    "DO NOT USE FOR COUNTS/AGGREGATIONS → use search_events",
    "DO NOT USE FOR individual events with timestamps → use search_events",
    "DO NOT USE FOR details about a specific issue → use get_sentry_resource",
    "",
    "<examples>",
    "search_issues(organizationSlug='my-org', query='critical bugs from last week')",
    "search_issues(organizationSlug='my-org', query='is:unresolved is:unassigned', sort='freq')",
    "search_issues(organizationSlug='my-org', query='level:error firstSeen:-24h', projectSlugOrId='my-project')",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, it's likely in the format of <organizationSlug>/<projectSlugOrId>.",
    "- Parse org/project notation directly without calling find_organizations or find_projects.",
    "- The projectSlugOrId parameter accepts both project slugs (e.g., 'my-project') and numeric IDs (e.g., '123456').",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    query: z
      .string()
      .trim()
      .default("is:unresolved")
      .describe("Natural language or Sentry issue search query syntax."),
    sort: z
      .enum(["date", "freq", "new", "user"])
      .default("date")
      .describe(
        "Sort order: date (last seen), freq (frequency), new (first seen), user (user count)",
      ),
    projectSlugOrId: z
      .string()
      .toLowerCase()
      .trim()
      .superRefine(validateSlugOrId)
      .nullable()
      .default(null)
      .describe("The project's slug or numeric ID (optional)"),
    regionUrl: ParamRegionUrl.nullable().default(null),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of issues to return (1-100)"),
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

    setTag("organization.slug", params.organizationSlug);
    if (params.projectSlugOrId) {
      if (isNumericId(params.projectSlugOrId)) {
        setTag("project.id", params.projectSlugOrId);
      } else {
        setTag("project.slug", params.projectSlugOrId);
      }
    }

    let query: string;
    let sort: "date" | "freq" | "new" | "user";
    let explanation: string | undefined;

    if (hasAgentProvider()) {
      // Agent mode: repair either natural language or already-structured params.
      let projectId: string | undefined;
      if (params.projectSlugOrId) {
        if (isNumericId(params.projectSlugOrId)) {
          projectId = params.projectSlugOrId;
        } else {
          const project = await apiService.getProject({
            organizationSlug: params.organizationSlug,
            projectSlugOrId: params.projectSlugOrId,
          });
          projectId = String(project.id);
        }
      }

      const agentResult = await searchIssuesAgent({
        query: buildIssueSearchRepairPrompt({
          query: params.query,
          sort: params.sort,
        }),
        organizationSlug: params.organizationSlug,
        apiService,
        projectId,
      });

      const translatedQuery = agentResult.result;
      query = translatedQuery.query ?? params.query;
      sort = translatedQuery.sort || params.sort;
      explanation = translatedQuery.explanation;
    } else {
      // Direct mode: use Sentry query syntax params as-is
      query = params.query;
      sort = params.sort;
    }

    const issues = await apiService.listIssues({
      organizationSlug: params.organizationSlug,
      projectSlug: params.projectSlugOrId ?? undefined,
      query,
      sortBy: sort,
      limit: params.limit,
    });

    // Build output with explanation first (if requested and NL was used), then results
    let output = "";

    if (params.includeExplanation && explanation) {
      output += `# Search Results for "${params.query}"\n\n`;
      output += `⚠️ **IMPORTANT**: Display these issues as highlighted cards with status indicators, assignee info, and clickable Issue IDs.\n\n`;

      output += `## Query Translation\n`;
      output += `Input query: "${params.query}"\n`;
      output += `Sentry query: \`${query}\``;
      output += `\nSort: ${sort}`;
      output += `\n\n`;

      if (explanation) {
        output += formatExplanation(explanation);
        output += `\n\n`;
      }

      output += formatIssueResults({
        issues,
        organizationSlug: params.organizationSlug,
        projectSlugOrId: params.projectSlugOrId ?? undefined,
        query,
        regionUrl: params.regionUrl ?? undefined,
        host: context.sentryHost,
        protocol: context.sentryProtocol,
        inputQuery: params.query,
        skipHeader: true,
      });
    } else {
      output = formatIssueResults({
        issues,
        organizationSlug: params.organizationSlug,
        projectSlugOrId: params.projectSlugOrId ?? undefined,
        query,
        regionUrl: params.regionUrl ?? undefined,
        host: context.sentryHost,
        protocol: context.sentryProtocol,
        inputQuery: params.query,
        skipHeader: false,
      });
    }

    return output;
  },
});
