import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext, withApiErrorHandling } from "./utils/api-utils";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlugOrAll,
  ParamTransaction,
  ParamQuery,
} from "../schema";

export default defineTool({
  name: "find_errors",
  description: [
    "Find errors in Sentry using advanced search syntax.",
    "",
    "Use this tool when you need to:",
    "- Search for production errors in a specific file.",
    "- Analyze error patterns and frequencies.",
    "- Find recent or frequently occurring errors.",
    "",
    "<examples>",
    "### Find common errors within a file",
    "",
    "To find common errors within a file, you can use the `filename` parameter. This is a suffix based search, so only using the filename or the direct parent folder of the file. The parent folder is preferred when the filename is in a subfolder or a common filename. If you provide generic filenames like `index.js` you're going to end up finding errors that are might be from completely different projects.",
    "",
    "```",
    "find_errors(organizationSlug='my-organization', filename='index.js', sortBy='count')",
    "```",
    "",
    "### Find recent crashes from the 'peated' project",
    "",
    "```",
    "find_errors(organizationSlug='my-organization', query='is:unresolved error.handled:false', projectSlug='peated', sortBy='last_seen')",
    "```",
    "",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
    "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you should call `find_organizations()` first.",
    "- If you are looking for issues, in a way that you might be looking for something like 'unresolved errors', you should use the `find_issues()` tool",
    "- You can use the `find_tags()` tool to see what user-defined tags are available.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    projectSlug: ParamProjectSlugOrAll.optional(),
    filename: z
      .string()
      .trim()
      .describe("The filename to search for errors in.")
      .optional(),
    transaction: ParamTransaction.optional(),
    query: ParamQuery.optional(),
    sortBy: z
      .enum(["last_seen", "count"])
      .optional()
      .default("last_seen")
      .describe(
        "Sort the results either by the last time they occurred or the count of occurrences.",
      ),
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    if (params.projectSlug) setTag("project.slug", params.projectSlug);

    const eventList = await withApiErrorHandling(
      () =>
        apiService.searchErrors({
          organizationSlug,
          projectSlug: params.projectSlug,
          filename: params.filename,
          query: params.query,
          transaction: params.transaction,
          sortBy: params.sortBy as "last_seen" | "count" | undefined,
        }),
      {
        organizationSlug,
        projectSlug: params.projectSlug,
      },
    );
    let output = `# Errors in **${organizationSlug}${params.projectSlug ? `/${params.projectSlug}` : ""}**\n\n`;
    if (params.query)
      output += `These errors match the query \`${params.query}\`\n`;
    if (params.filename)
      output += `These errors are limited to the file suffix \`${params.filename}\`\n`;
    output += "\n";
    if (eventList.length === 0) {
      output += `No results found\n\n`;
      output += `We searched within the ${organizationSlug} organization.\n\n`;
      return output;
    }
    for (const eventSummary of eventList) {
      output += `## ${eventSummary.issue}\n\n`;
      output += `**Description**: ${eventSummary.title}\n`;
      output += `**Issue ID**: ${eventSummary.issue}\n`;
      output += `**URL**: ${apiService.getIssueUrl(organizationSlug, eventSummary.issue)}\n`;
      output += `**Project**: ${eventSummary.project}\n`;
      output += `**Last Seen**: ${eventSummary["last_seen()"]}\n`;
      output += `**Occurrences**: ${eventSummary["count()"]}\n\n`;
    }
    output += "# Using this information\n\n";
    output += `- You can reference the Issue ID in commit messages (e.g. \`Fixes <issueID>\`) to automatically close the issue when the commit is merged.\n`;
    output += `- You can get more details about an error by using the tool: \`get_issue_details(organizationSlug="${organizationSlug}", issueId=<issueID>)\`\n`;
    return output;
  },
});
