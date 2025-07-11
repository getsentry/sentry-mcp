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
    "Find grouped issues in Sentry (not individual events).",
    "",
    "IMPORTANT: Issues are grouped errors/problems. Use this for questions about 'issues', 'problems', or when users want summaries.",
    "Use this tool when you need to:",
    "- View all issues in a Sentry organization",
    "- Find production issues, recent issues, or issues affecting specific users",
    "- Get issue counts or summaries",
    "",
    "If you're looking for individual error occurrences or events, use the `search_events()` tool instead.",
    "",
    "<examples>",
    "### Find the newest unresolved issues across 'my-organization'",
    "",
    "```",
    "find_issues(organizationSlug='my-organization', query='is:unresolved', sortBy='last_seen')",
    "```",
    "",
    "### Find the most frequently occurring crashes in the 'my-project' project",
    "",
    "```",
    "find_issues(organizationSlug='my-organization', projectSlug='my-project', query='is:unresolved error.handled:false', sortBy='count')",
    "```",
    "",
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
