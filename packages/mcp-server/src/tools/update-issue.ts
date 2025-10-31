import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { parseIssueParams } from "../internal/tool-helpers/issue";
import { formatAssignedTo } from "../internal/tool-helpers/formatting";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
  ParamIssueStatus,
  ParamAssignedTo,
} from "../schema";

export default defineTool({
  name: "update_issue",
  requiredSkills: ["triage"], // Only available in triage skill
  requiredScopes: ["event:write"],
  description: [
    "Update an issue's status or assignment in Sentry. This allows you to resolve, ignore, or reassign issues.",
    "",
    "Use this tool when you need to:",
    "- Resolve an issue that has been fixed",
    "- Assign an issue to a team member or team for investigation",
    "- Mark an issue as ignored to reduce noise",
    "- Reopen a resolved issue by setting status to 'unresolved'",
    "",
    "<examples>",
    "### Resolve an issue",
    "",
    "```",
    "update_issue(organizationSlug='my-organization', issueId='PROJECT-123', status='resolved')",
    "```",
    "",
    "### Assign an issue to a user (use whoami to get your user ID)",
    "",
    "```",
    "update_issue(organizationSlug='my-organization', issueId='PROJECT-123', assignedTo='user:123456')",
    "```",
    "",
    "### Assign an issue to a team",
    "",
    "```",
    "update_issue(organizationSlug='my-organization', issueId='PROJECT-123', assignedTo='team:789')",
    "```",
    "",
    "### Mark an issue as ignored",
    "",
    "```",
    "update_issue(organizationSlug='my-organization', issueId='PROJECT-123', status='ignored')",
    "```",
    "",
    "</examples>",
    "",
    "<hints>",
    "- If the user provides the `issueUrl`, you can ignore the other required parameters and extract them from the URL.",
    "- At least one of `status` or `assignedTo` must be provided to update the issue.",
    "- assignedTo format: Use 'user:ID' for users (e.g., 'user:123456') or 'team:ID' for teams (e.g., 'team:789')",
    "- To find your user ID, first use the whoami tool which returns your numeric user ID",
    "- Valid status values are: 'resolved', 'resolvedInNextRelease', 'unresolved', 'ignored'.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.optional(),
    issueId: ParamIssueShortId.optional(),
    issueUrl: ParamIssueUrl.optional(),
    status: ParamIssueStatus.optional(),
    assignedTo: ParamAssignedTo.optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
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

    // Validate that at least one update parameter is provided
    if (!params.status && !params.assignedTo) {
      throw new UserInputError(
        "At least one of `status` or `assignedTo` must be provided to update the issue",
      );
    }

    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    setTag("organization.slug", orgSlug);

    // Get current issue details first
    const currentIssue = await apiService.getIssue({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
    });

    // Update the issue
    const updatedIssue = await apiService.updateIssue({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
      status: params.status,
      assignedTo: params.assignedTo,
    });

    let output = `# Issue ${updatedIssue.shortId} Updated in **${orgSlug}**\n\n`;
    output += `**Issue**: ${updatedIssue.title}\n`;
    output += `**URL**: ${apiService.getIssueUrl(orgSlug, updatedIssue.shortId)}\n\n`;

    // Show what changed
    output += "## Changes Made\n\n";

    if (params.status && currentIssue.status !== params.status) {
      output += `**Status**: ${currentIssue.status} → **${params.status}**\n`;
    }

    if (params.assignedTo) {
      const oldAssignee = formatAssignedTo(currentIssue.assignedTo ?? null);
      const newAssignee =
        params.assignedTo === "me" ? "You" : params.assignedTo;
      output += `**Assigned To**: ${oldAssignee} → **${newAssignee}**\n`;
    }

    output += "\n## Current Status\n\n";
    output += `**Status**: ${updatedIssue.status}\n`;
    const currentAssignee = formatAssignedTo(updatedIssue.assignedTo ?? null);
    output += `**Assigned To**: ${currentAssignee}\n`;

    output += "\n# Using this information\n\n";
    output += `- The issue has been successfully updated in Sentry\n`;
    output += `- You can view the issue details using: \`get_issue_details(organizationSlug="${orgSlug}", issueId="${updatedIssue.shortId}")\`\n`;

    if (params.status === "resolved") {
      output += `- The issue is now marked as resolved and will no longer generate alerts\n`;
    } else if (params.status === "ignored") {
      output += `- The issue is now ignored and will not generate alerts until it escalates\n`;
    }

    return output;
  },
});
