import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { parseIssueParams } from "../internal/tool-helpers/issue";
import { enhanceNotFoundError } from "../internal/tool-helpers/enhance-error";
import { ApiNotFoundError } from "../api-client";
import type { ServerContext } from "../types";
import { UserInputError } from "../errors";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
} from "../schema";

export default defineTool({
  name: "get_issue_external_links",
  skills: ["inspect", "triage"], // Available in inspect and triage skills
  requiredScopes: ["event:read"],
  description: [
    "Get external issue links (Jira, GitHub Issues, etc.) for a specific Sentry issue.",
    "",
    "USE THIS TOOL WHEN USERS:",
    "- Want to know if a Jira ticket is linked to a Sentry issue",
    "- Ask 'is there a Jira for this?', 'what's the Jira ticket?'",
    "- Need to find GitHub/GitLab issues linked to a Sentry issue",
    "- Want to see all external issue tracking links",
    "",
    "DO NOT USE for:",
    "- Creating new external issues (not yet implemented)",
    "- General issue searching (use search_issues)",
    "",
    "TRIGGER PATTERNS:",
    "- 'Is there a Jira for ISSUE-123?' → use get_issue_external_links",
    "- 'What external issues are linked?' → use get_issue_external_links",
    "- 'Show me the Jira ticket for this error' → use get_issue_external_links",
    "",
    "<examples>",
    "### With Sentry URL (recommended)",
    "```",
    "get_issue_external_links(issueUrl='https://sentry.io/issues/PROJECT-123/')",
    "```",
    "",
    "### With issue ID and organization",
    "```",
    "get_issue_external_links(organizationSlug='my-organization', issueId='PROJECT-123')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- **IMPORTANT**: If user provides a Sentry URL, pass the ENTIRE URL to issueUrl parameter unchanged",
    "- Returns empty array if no external issues are linked",
    "- Includes serviceType (e.g., 'jira', 'github'), displayName (e.g., 'AMP-12345'), and webUrl",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),
    issueId: ParamIssueShortId.optional(),
    issueUrl: ParamIssueUrl.optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

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

    // Fetch external issue links
    let externalIssues;
    try {
      externalIssues = await apiService.getIssueExternalLinks({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
      });
    } catch (error) {
      if (error instanceof ApiNotFoundError) {
        throw enhanceNotFoundError(error, {
          organizationSlug: orgSlug,
          issueId: parsedIssueId,
        });
      }
      throw error;
    }

    // Format the output
    if (externalIssues.length === 0) {
      return [
        `# No External Issues Found`,
        ``,
        `No external issue tracking links (Jira, GitHub, etc.) are connected to this Sentry issue.`,
        ``,
        `**Issue ID**: ${parsedIssueId}`,
        `**Organization**: ${orgSlug}`,
      ].join("\n");
    }

    const lines = [
      `# External Issue Links for ${parsedIssueId}`,
      ``,
      `Found ${externalIssues.length} external issue link(s) connected to this Sentry issue:`,
      ``,
    ];

    for (const issue of externalIssues) {
      lines.push(`## ${issue.displayName}`);
      lines.push(``);
      lines.push(`- **Type**: ${issue.serviceType}`);
      lines.push(`- **URL**: ${issue.webUrl}`);
      lines.push(`- **ID**: ${issue.id}`);
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(``);
    lines.push(
      `Use these external issue links to track the status in your issue tracking system.`,
    );

    return lines.join("\n");
  },
});
