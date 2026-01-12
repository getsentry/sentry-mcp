import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { parseIssueParams } from "../internal/tool-helpers/issue";
import { enhanceNotFoundError } from "../internal/tool-helpers/enhance-error";
import { ApiNotFoundError } from "../api-client";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
} from "../schema";

export default defineTool({
  name: "get_issue_tag_values",
  skills: ["inspect"], // Available in inspect skill for understanding issue distribution
  requiredScopes: ["event:read"],
  description: [
    "Get tag value distribution for a specific Sentry issue.",
    "",
    "Use this tool when you need to:",
    "- Understand how an issue is distributed across different tag values",
    "- Get aggregate counts of unique tag values (e.g., 'how many unique URLs are affected')",
    "- Analyze which browsers, environments, or URLs are most impacted by an issue",
    "- View the tag distributions page data programmatically",
    "",
    "Common tag keys:",
    "- `url`: Request URLs affected by the issue",
    "- `browser`: Browser types and versions",
    "- `browser.name`: Browser names only",
    "- `os`: Operating systems",
    "- `environment`: Deployment environments (production, staging, etc.)",
    "- `release`: Software releases",
    "- `device`: Device types",
    "- `user`: Affected users",
    "",
    "<examples>",
    "### Get URL distribution for an issue",
    "```",
    "get_issue_tag_values(organizationSlug='my-organization', issueId='PROJECT-123', tagKey='url')",
    "```",
    "",
    "### Get browser distribution using issue URL",
    "```",
    "get_issue_tag_values(issueUrl='https://sentry.io/issues/PROJECT-123/', tagKey='browser')",
    "```",
    "",
    "### Get environment distribution",
    "```",
    "get_issue_tag_values(organizationSlug='my-organization', issueId='PROJECT-123', tagKey='environment')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If user provides a Sentry URL, pass the ENTIRE URL to issueUrl parameter unchanged",
    "- Common tag keys: url, browser, browser.name, os, environment, release, device, user",
    "- Tag keys are case-sensitive",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),
    issueId: ParamIssueShortId.optional(),
    issueUrl: ParamIssueUrl.optional(),
    tagKey: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
        "Tag key must contain only alphanumeric characters, dots, hyphens, and underscores, and must start with an alphanumeric character",
      )
      .describe(
        "The tag key to get values for (e.g., 'url', 'browser', 'environment', 'release').",
      ),
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

    if (!params.tagKey) {
      throw new UserInputError(
        "`tagKey` is required. Common values: url, browser, environment, release, os, device, user",
      );
    }

    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    setTag("organization.slug", orgSlug);

    // Fetch the tag values for the issue
    let tagValues: Awaited<ReturnType<typeof apiService.getIssueTagValues>>;
    try {
      tagValues = await apiService.getIssueTagValues({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
        tagKey: params.tagKey,
      });
    } catch (error) {
      if (error instanceof ApiNotFoundError) {
        throw enhanceNotFoundError(error, {
          organizationSlug: orgSlug,
          issueId: parsedIssueId,
          tagKey: params.tagKey,
        });
      }
      throw error;
    }

    // Format the output
    let output = `# Tag Distribution: ${tagValues.name}\n\n`;
    output += `**Issue**: ${parsedIssueId}\n`;
    output += `**Tag Key**: \`${tagValues.key}\`\n`;
    output += `**Total Unique Values**: ${tagValues.totalValues}\n\n`;

    if (tagValues.topValues.length === 0) {
      output += "No values found for this tag.\n";
      return output;
    }

    output += "## Top Values\n\n";
    output += "| Value | Count | First Seen | Last Seen |\n";
    output += "|-------|-------|------------|----------|\n";

    for (const value of tagValues.topValues) {
      const firstSeen = value.firstSeen
        ? new Date(value.firstSeen).toISOString().split("T")[0]
        : "-";
      const lastSeen = value.lastSeen
        ? new Date(value.lastSeen).toISOString().split("T")[0]
        : "-";
      // Handle null values (can occur with certain tag types)
      const rawValue = value.value ?? "(null)";
      // Truncate long values for readability
      let displayValue =
        rawValue.length > 60 ? `${rawValue.substring(0, 57)}...` : rawValue;
      // Escape markdown table special characters (backslashes first)
      displayValue = displayValue
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|")
        .replace(/`/g, "\\`")
        .replace(/\n/g, " ");
      output += `| \`${displayValue}\` | ${value.count} | ${firstSeen} | ${lastSeen} |\n`;
    }

    if (tagValues.topValues.length > 0 && tagValues.totalValues > 0) {
      const shownCount = tagValues.topValues.length;
      output += `\n*Showing top ${shownCount} of ${tagValues.totalValues} unique values*\n`;
    }

    // Add usage hints
    output += "\n## Using this information\n\n";
    output += `- Use \`get_issue_details(organizationSlug='${orgSlug}', issueId='${parsedIssueId}')\` to see the full issue details\n`;
    output += `- Try other tag keys like: url, browser, environment, release, os, device, user\n`;

    return output;
  },
});
