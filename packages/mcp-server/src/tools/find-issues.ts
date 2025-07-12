import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext, withApiErrorHandling } from "./utils/api-utils";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
  ParamQuery,
} from "../schema";

export default defineTool({
  name: "find_issues",
  description: [
    "Find grouped issues/problems in Sentry - NOT individual events.",
    "",
    "🔍 USE THIS TOOL WHEN USERS ASK FOR:",
    "- 'show me issues', 'list problems', 'what issues do we have'",
    "- 'unresolved issues', 'recent problems affecting users'",
    "- 'issue summaries', 'grouped errors', 'error types'",
    "- General questions about problems without specific event details",
    "",
    "❌ DO NOT USE when users want:",
    "- Specific error events/logs from a time period (use search_events)",
    "- Individual occurrences with timestamps (use search_events)",
    "- Details about a specific issue ID like 'PROJECT-123' (use get_issue_details)",
    "",
    "CRITICAL: Issues are grouped/deduplicated problems, not individual events.",
    "",
    "<examples>",
    "### Find unresolved issues",
    "```",
    "find_issues(organizationSlug='my-organization', query='is:unresolved', sortBy='last_seen')",
    "```",
    "",
    "### Find crashes in project",
    "```",
    "find_issues(organizationSlug='my-organization', projectSlug='my-project', query='is:unresolved error.handled:false', sortBy='count')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
    "- You can use the `find_tags()` tool to see what user-defined tags are available.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    projectSlug: ParamProjectSlug.optional(),
    query: ParamQuery.optional(),
    sortBy: z
      .enum(["last_seen", "first_seen", "count", "userCount"])
      .describe(
        "Sort the results either by the last time they occurred, the first time they occurred, the count of occurrences, or the number of users affected.",
      )
      .optional(),
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);

    const sortByMap = {
      last_seen: "date" as const,
      first_seen: "new" as const,
      count: "freq" as const,
      userCount: "user" as const,
    };
    const issues = await withApiErrorHandling(
      () =>
        apiService.listIssues({
          organizationSlug,
          projectSlug: params.projectSlug,
          query: params.query,
          sortBy: params.sortBy
            ? sortByMap[params.sortBy as keyof typeof sortByMap]
            : undefined,
        }),
      {
        organizationSlug,
        projectSlug: params.projectSlug,
      },
    );
    let output = `# Issues in **${organizationSlug}${params.projectSlug ? `/${params.projectSlug}` : ""}**\n\n`;
    if (issues.length === 0) {
      output += "No issues found.\n";
      return output;
    }
    output += issues
      .map((issue) =>
        [
          `## ${issue.shortId}`,
          "",
          `**Description**: ${issue.title}`,
          `**Culprit**: ${issue.culprit}`,
          `**First Seen**: ${new Date(issue.firstSeen).toISOString()}`,
          `**Last Seen**: ${new Date(issue.lastSeen).toISOString()}`,
          `**URL**: ${apiService.getIssueUrl(organizationSlug, issue.shortId)}`,
        ].join("\n"),
      )
      .join("\n\n");
    output += "\n\n";
    output += "# Using this information\n\n";
    output += `- You can reference the Issue ID in commit messages (e.g. \`Fixes <issueID>\`) to automatically close the issue when the commit is merged.\n`;
    output += `- You can get more details about a specific issue by using the tool: \`get_issue_details(organizationSlug="${organizationSlug}", issueId=<issueID>)\`\n`;
    return output;
  },
});
