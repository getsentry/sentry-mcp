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
    projectSlug?: string;
  },
  apiService: SentryApiService,
  maxRetries = 1,
) {
  let previousError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await translateQuery(params, apiService, previousError);
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
    "Search for grouped issues/problems in Sentry using natural language - NOT individual events.",
    "",
    "Uses AI to translate natural language queries into Sentry issue search syntax.",
    "Returns grouped issues with links to the Sentry UI.",
    "",
    "🔍 USE THIS TOOL WHEN USERS ASK FOR:",
    "- 'show me issues', 'list problems', 'what issues do we have'",
    "- 'unresolved issues', 'recent problems affecting users'",
    "- 'critical bugs from last week'",
    "- 'errors affecting more than 100 users'",
    "",
    "❌ DO NOT USE when users want:",
    "- Specific error events/logs from a time period (use search_events)",
    "- Individual occurrences with timestamps (use search_events)",
    "- Details about a specific issue ID like 'PROJECT-123' (use get_issue_details)",
    "",
    "CRITICAL: Issues are grouped/deduplicated problems, not individual events.",
    "",
    "<examples>",
    "search_issues(organizationSlug='my-org', naturalLanguageQuery='critical bugs from last week')",
    "search_issues(organizationSlug='my-org', naturalLanguageQuery='unhandled errors affecting 100+ users')",
    "search_issues(organizationSlug='my-org', naturalLanguageQuery='issues assigned to me')",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, it's likely in the format of <organizationSlug>/<projectSlug>.",
    "- Parse org/project notation directly without calling find_organizations or find_projects.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .describe("Natural language description of issues to search for"),
    projectSlug: ParamProjectSlug.optional(),
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
    if (params.projectSlug) {
      setTag("search_issues.projectSlug", params.projectSlug);
    }

    // Translate natural language to Sentry query
    const translatedQuery = await translateQueryWithErrorFeedback(
      params,
      apiService,
      1, // max retries
    );

    // Execute the search
    const issues = await withApiErrorHandling(
      () =>
        apiService.listIssues({
          organizationSlug: params.organizationSlug,
          projectSlug: params.projectSlug,
          query: translatedQuery.query,
          sortBy: translatedQuery.sort || "date",
          limit: params.limit,
        }),
      {
        organizationSlug: params.organizationSlug,
        projectSlug: params.projectSlug,
        query: translatedQuery.query,
      },
    );

    // Format the results
    let output = formatIssueResults(
      issues,
      params.organizationSlug,
      params.projectSlug,
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
