import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import { validateSlugOrId, isNumericId } from "../../utils/slug-validation";
import { searchIssuesAgent } from "./agent";
import { formatIssueResults, formatExplanation } from "./formatters";

export default defineTool({
  name: "search_issues",
  requiredSkills: ["inspect", "triage", "seer"], // Available in inspect, triage, and seer skills
  requiredScopes: ["event:read"],
  description: [
    "Search for grouped issues/problems in Sentry - returns a LIST of issues, NOT counts or aggregations.",
    "",
    "Uses AI to translate natural language queries into Sentry issue search syntax.",
    "Returns grouped issues with metadata like title, status, and user count.",
    "",
    "🔍 USE THIS TOOL WHEN USERS WANT:",
    "- A LIST of issues: 'show me issues', 'what problems do we have'",
    "- Filtered issue lists: 'unresolved issues', 'critical bugs'",
    "- Issues by impact: 'errors affecting more than 100 users'",
    "- Issues by assignment: 'issues assigned to me'",
    "",
    "❌ DO NOT USE FOR COUNTS/AGGREGATIONS:",
    "- 'how many errors' → use search_events",
    "- 'count of issues' → use search_events",
    "- 'total number of errors today' → use search_events",
    "- 'sum/average/statistics' → use search_events",
    "",
    "❌ ALSO DO NOT USE FOR:",
    "- Individual error events with timestamps → use search_events",
    "- Details about a specific issue ID → use get_issue_details",
    "",
    "REMEMBER: This tool returns a LIST of issues, not counts or statistics!",
    "",
    "<examples>",
    "search_issues(organizationSlug='my-org', naturalLanguageQuery='critical bugs from last week')",
    "search_issues(organizationSlug='my-org', naturalLanguageQuery='unhandled errors affecting 100+ users')",
    "search_issues(organizationSlug='my-org', naturalLanguageQuery='issues assigned to me')",
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
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .describe("Natural language description of issues to search for"),
    projectSlugOrId: z
      .string()
      .toLowerCase()
      .trim()
      .superRefine(validateSlugOrId)
      .optional()
      .describe("The project's slug or numeric ID (optional)"),
    regionUrl: ParamRegionUrl.optional(),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe("Maximum number of issues to return"),
    includeExplanation: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include explanation of how the query was translated"),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });

    setTag("organization.slug", params.organizationSlug);
    if (params.projectSlugOrId) {
      // Check if it's a numeric ID or a slug and tag appropriately
      if (isNumericId(params.projectSlugOrId)) {
        setTag("project.id", params.projectSlugOrId);
      } else {
        setTag("project.slug", params.projectSlugOrId);
      }
    }

    // Convert project slug to ID if needed - required for the agent's field discovery
    let projectId: string | undefined;
    if (params.projectSlugOrId) {
      // Check if it's already a numeric ID
      if (isNumericId(params.projectSlugOrId)) {
        projectId = params.projectSlugOrId;
      } else {
        // It's a slug, convert to ID
        const project = await apiService.getProject({
          organizationSlug: params.organizationSlug,
          projectSlugOrId: params.projectSlugOrId!,
        });
        projectId = String(project.id);
      }
    }

    // Translate natural language to Sentry query
    const agentResult = await searchIssuesAgent({
      query: params.naturalLanguageQuery,
      organizationSlug: params.organizationSlug,
      apiService,
      projectId,
    });

    const translatedQuery = agentResult.result;

    // Execute the search - listIssues accepts projectSlug directly
    const issues = await apiService.listIssues({
      organizationSlug: params.organizationSlug,
      projectSlug: params.projectSlugOrId,
      query: translatedQuery.query,
      sortBy: translatedQuery.sort || "date",
      limit: params.limit,
    });

    // Build output with explanation first (if requested), then results
    let output = "";

    // Add explanation section before results (like search_events)
    if (params.includeExplanation) {
      // Start with title including natural language query
      output += `# Search Results for "${params.naturalLanguageQuery}"\n\n`;
      output += `⚠️ **IMPORTANT**: Display these issues as highlighted cards with status indicators, assignee info, and clickable Issue IDs.\n\n`;

      output += `## Query Translation\n`;
      output += `Natural language: "${params.naturalLanguageQuery}"\n`;
      output += `Sentry query: \`${translatedQuery.query}\``;
      if (translatedQuery.sort) {
        output += `\nSort: ${translatedQuery.sort}`;
      }
      output += `\n\n`;

      if (translatedQuery.explanation) {
        output += formatExplanation(translatedQuery.explanation);
        output += `\n\n`;
      }

      // Format results without the header since we already added it
      output += formatIssueResults({
        issues,
        organizationSlug: params.organizationSlug,
        projectSlugOrId: params.projectSlugOrId,
        query: translatedQuery.query,
        regionUrl: params.regionUrl,
        naturalLanguageQuery: params.naturalLanguageQuery,
        skipHeader: true,
      });
    } else {
      // Format results with natural language query for title
      output = formatIssueResults({
        issues,
        organizationSlug: params.organizationSlug,
        projectSlugOrId: params.projectSlugOrId,
        query: translatedQuery.query,
        regionUrl: params.regionUrl,
        naturalLanguageQuery: params.naturalLanguageQuery,
        skipHeader: false,
      });
    }

    return output;
  },
});
