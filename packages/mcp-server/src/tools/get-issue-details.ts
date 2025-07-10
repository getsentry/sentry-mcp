import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext, withApiErrorHandling } from "./utils/api-utils";
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
    "Use this tool when you need to:",
    "- View error details, stacktraces, and metadata",
    "- Investigate when/where an error occurred",
    "- Access raw error information from Sentry",
    "- Get comprehensive issue information including any available Seer analysis",
    "",
    "Do NOT use this tool when:",
    "- User wants root cause analysis → Use `analyze_issue_with_seer`",
    "",
    "<examples>",
    '### User: "How do I fix ISSUE-123?"',
    "",
    "```",
    "get_issue_details(organizationSlug='my-organization', issueId='ISSUE-123')",
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

      // Try to fetch Seer analysis context (non-blocking)
      let autofixState:
        | Awaited<ReturnType<typeof apiService.getAutofixState>>
        | undefined;
      try {
        autofixState = await apiService.getAutofixState({
          organizationSlug: orgSlug,
          issueId: issue.shortId,
        });
      } catch (error) {
        // Silently continue if Seer analysis is not available
        // This ensures the tool works even if Seer is not enabled
      }

      return formatIssueOutput({
        organizationSlug: orgSlug,
        issue,
        event,
        apiService,
        autofixState,
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

    const issue = await withApiErrorHandling(
      () =>
        apiService.getIssue({
          organizationSlug: orgSlug,
          issueId: parsedIssueId!,
        }),
      {
        organizationSlug: orgSlug,
        issueId: parsedIssueId,
      },
    );

    const event = await apiService.getLatestEventForIssue({
      organizationSlug: orgSlug,
      issueId: issue.shortId,
    });

    // Try to fetch Seer analysis context (non-blocking)
    let autofixState:
      | Awaited<ReturnType<typeof apiService.getAutofixState>>
      | undefined;
    try {
      autofixState = await apiService.getAutofixState({
        organizationSlug: orgSlug,
        issueId: issue.shortId,
      });
    } catch (error) {
      // Silently continue if Seer analysis is not available
      // This ensures the tool works even if Seer is not enabled
    }

    return formatIssueOutput({
      organizationSlug: orgSlug,
      issue,
      event,
      apiService,
      autofixState,
    });
  },
});
