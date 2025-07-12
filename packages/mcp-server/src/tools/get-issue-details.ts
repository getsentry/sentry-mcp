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
    "Get detailed information about a specific Sentry issue by ID.",
    "",
    "🔍 USE THIS TOOL WHEN USERS:",
    "- Provide a specific issue ID (e.g., 'CLOUDFLARE-MCP-41', 'PROJECT-123')",
    "- Ask to 'explain [ISSUE-ID]', 'tell me about [ISSUE-ID]'",
    "- Want details/stacktrace/analysis for a known issue",
    "- Provide a Sentry issue URL",
    "",
    "❌ DO NOT USE for:",
    "- General searching or listing issues (use find_issues)",
    "- Root cause analysis (use analyze_issue_with_seer)",
    "",
    "TRIGGER PATTERNS:",
    "- 'Explain ISSUE-123' → use get_issue_details",
    "- 'Tell me about PROJECT-456' → use get_issue_details",
    "- 'What happened in [issue URL]' → use get_issue_details",
    "",
    "<examples>",
    "### Explain specific issue",
    "```",
    "get_issue_details(organizationSlug='my-organization', issueId='CLOUDFLARE-MCP-41')",
    "```",
    "",
    "### Get details for event ID",
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
