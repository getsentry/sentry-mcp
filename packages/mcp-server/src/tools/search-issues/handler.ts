import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../utils/defineTool";
import {
  apiServiceFromContext,
  withApiErrorHandling,
} from "../utils/api-utils";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../../schema";
import { translateQuery } from "./agent";
import { formatIssueResults } from "./formatters";
import { UserInputError } from "../../errors";
import type { SentryApiService } from "../../api-client";

/**
 * Translate query with error feedback for self-correction
 */
async function translateQueryWithErrorFeedback(
  params: {
    naturalLanguageQuery: string;
    organizationSlug: string;
    projectSlugOrId?: string;
    projectId?: string;
  },
  apiService: SentryApiService,
  maxRetries = 1,
) {
  let previousError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await translateQuery(
        {
          naturalLanguageQuery: params.naturalLanguageQuery,
          organizationSlug: params.organizationSlug,
          projectSlugOrId: params.projectSlugOrId,
          projectId: params.projectId,
        },
        apiService,
        previousError,
      );
    } catch (error) {
      if (error instanceof UserInputError && attempt < maxRetries) {
        // Feed the validation error back to the agent for self-correction
        previousError = error.message;
        continue;
      }
      // Re-throw if it's not a UserInputError or we've exceeded retries
      throw error;
    }
  }

  // This should never be reached due to the throw above, but TypeScript needs it
  throw new Error("Unexpected error in translateQueryWithErrorFeedback");
}

export default defineTool({
  name: "search_issues",
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
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });

    setTag("search_issues.organizationSlug", params.organizationSlug);
    if (params.projectSlugOrId) {
      setTag("search_issues.projectSlugOrId", params.projectSlugOrId);
    }

    // Convert project slug to ID if needed - required for the agent's field discovery
    let projectId: string | undefined;
    if (params.projectSlugOrId) {
      // Check if it's already a numeric ID
      if (/^\d+$/.test(params.projectSlugOrId)) {
        projectId = params.projectSlugOrId;
      } else {
        // It's a slug, convert to ID
        try {
          const project = await apiService.getProject({
            organizationSlug: params.organizationSlug,
            projectSlugOrId: params.projectSlugOrId,
          });
          projectId = String(project.id);
        } catch (error) {
          throw new Error(
            `Project '${params.projectSlugOrId}' not found in organization '${params.organizationSlug}'`,
          );
        }
      }
    }

    // Translate natural language to Sentry query
    const translatedQuery = await translateQueryWithErrorFeedback(
      {
        naturalLanguageQuery: params.naturalLanguageQuery,
        organizationSlug: params.organizationSlug,
        projectSlugOrId: params.projectSlugOrId,
        projectId,
      },
      apiService,
      1, // max retries
    );

    // Execute the search - listIssues accepts projectSlug directly
    const issues = await withApiErrorHandling(
      () =>
        apiService.listIssues({
          organizationSlug: params.organizationSlug,
          projectSlug: params.projectSlugOrId,
          query: translatedQuery.query,
          sortBy: translatedQuery.sort || "date",
          limit: params.limit,
        }),
      {
        organizationSlug: params.organizationSlug,
        projectSlug: params.projectSlugOrId,
        query: translatedQuery.query,
      },
    );

    // Format the results
    let output = formatIssueResults(
      issues,
      params.organizationSlug,
      params.projectSlugOrId,
      translatedQuery.query,
      params.regionUrl,
    );

    // Add explanation if requested
    if (params.includeExplanation) {
      output += "\n\n## Query Translation\n\n";
      output += `**Natural Language**: ${params.naturalLanguageQuery}\n\n`;
      output += `**Sentry Query**: \`${translatedQuery.query}\``;
      if (translatedQuery.sort) {
        output += `\n**Sort**: ${translatedQuery.sort}`;
      }
      if (translatedQuery.explanation) {
        output += `\n\n${translatedQuery.explanation}`;
      }
    }

    return output;
  },
});
