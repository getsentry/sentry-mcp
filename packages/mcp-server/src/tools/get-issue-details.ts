import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext } from "./utils/api-utils";
import { parseIssueParams, formatIssueOutput } from "./utils/issue-utils";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
} from "../schema";

export default defineTool({
  name: "get_issue_details",
  description: [
    "Retrieve issue details from Sentry for a specific Issue ID, including the stacktrace and error message if available. Either issueId or issueUrl MUST be provided.",
    "",
    "**NOTE: If the user asks HOW TO FIX an issue, use `analyze_issue_with_seer` instead!**",
    "",
    "Use this tool when you need to:",
    "- View error details, stacktraces, and metadata",
    "- Investigate when/where an error occurred",
    "- Access raw error information from Sentry",
    "",
    "Do NOT use this tool when:",
    '- User asks "how do I fix this?" → Use `analyze_issue_with_seer`',
    "- User wants root cause analysis → Use `analyze_issue_with_seer`",
    "- User needs code fixes → Use `analyze_issue_with_seer`",
    "",
    "<examples>",
    "### Get details for issue ID 'CLOUDFLARE-MCP-41'",
    "",
    "```",
    "get_issue_details(organizationSlug='my-organization', issueId='CLOUDFLARE-MCP-41')",
    "```",
    "",
    "### Get details for event ID 'c49541c747cb4d8aa3efb70ca5aba243'",
    "",
    "```",
    "get_issue_details(organizationSlug='my-organization', eventId='c49541c747cb4d8aa3efb70ca5aba243')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If the user provides the `issueUrl`, you can ignore the other parameters.",
    "- If the user provides `issueId` or `eventId` (only one is needed), `organizationSlug` is required.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.optional(),
    issueId: ParamIssueShortId.optional(),
    eventId: z.string().trim().describe("The ID of the event.").optional(),
    issueUrl: ParamIssueUrl.optional(),
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });

    if (params.eventId) {
      const orgSlug = params.organizationSlug;
      if (!orgSlug) {
        throw new UserInputError(
          "`organizationSlug` is required when providing `eventId`",
        );
      }

      setTag("organization.slug", orgSlug);
      const [issue] = await apiService.listIssues({
        organizationSlug: orgSlug,
        query: params.eventId,
      });
      if (!issue) {
        return `# Event Not Found\n\nNo issue found for Event ID: ${params.eventId}`;
      }
      const event = await apiService.getEventForIssue({
        organizationSlug: orgSlug,
        issueId: issue.shortId,
        eventId: params.eventId,
      });
      return formatIssueOutput({
        organizationSlug: orgSlug,
        issue,
        event,
        apiService,
      });
    }

    // Validate that we have the minimum required parameters
    if (!params.issueUrl && !params.issueId) {
      throw new UserInputError(
        "Either `issueId` or `issueUrl` must be provided",
      );
    }

    if (!params.issueUrl && !params.organizationSlug) {
      throw new UserInputError(
        "`organizationSlug` is required when providing `issueId`",
      );
    }

    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    setTag("organization.slug", orgSlug);

    const issue = await apiService.getIssue({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
    });
    const event = await apiService.getLatestEventForIssue({
      organizationSlug: orgSlug,
      issueId: issue.shortId,
    });
    return formatIssueOutput({
      organizationSlug: orgSlug,
      issue,
      event,
      apiService,
    });
  },
});
