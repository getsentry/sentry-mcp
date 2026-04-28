import type { Issue } from "../../api-client";
import { logInfo } from "../../telem/logging";
import { getIssueUrl, getIssuesSearchUrl } from "../../utils/url-utils";
import { getSeerActionabilityLabel } from "../../internal/formatting";
import type { SentryProtocol } from "../../types";

/**
 * Format an explanation for how the input query was translated
 */
export function formatExplanation(explanation: string): string {
  return `## How I interpreted your query\n\n${explanation}`;
}

export interface FormatIssueResultsParams {
  issues: Issue[];
  organizationSlug: string;
  projectSlugOrId?: string;
  query?: string | null;
  regionUrl?: string;
  host?: string;
  protocol?: SentryProtocol;
  inputQuery?: string;
  skipHeader?: boolean;
}

/**
 * Format issue search results for display
 */
export function formatIssueResults(params: FormatIssueResultsParams): string {
  const {
    issues,
    organizationSlug,
    projectSlugOrId,
    query,
    regionUrl,
    host,
    protocol = "https",
    inputQuery,
    skipHeader = false,
  } = params;

  const region = regionUrl ? new URL(regionUrl) : null;
  const resolvedHost = region?.host || host || "sentry.io";
  const resolvedProtocol =
    (region?.protocol.replace(":", "") as SentryProtocol | undefined) ||
    protocol;

  let output = "";

  // Skip header section if requested (when called from handler with includeExplanation)
  if (!skipHeader) {
    // Use the original input in the title if provided, otherwise fall back to org/project.
    if (inputQuery) {
      output = `# Search Results for "${inputQuery}"\n\n`;
    } else {
      output = `# Issues in **${organizationSlug}`;
      if (projectSlugOrId) {
        output += `/${projectSlugOrId}`;
      }
      output += "**\n\n";
    }

    // Add display instructions for UI
    output += `⚠️ **IMPORTANT**: Display these issues as highlighted cards with status indicators, assignee info, and clickable Issue IDs.\n\n`;
  }

  if (issues.length === 0) {
    logInfo(`No issues found for query: ${inputQuery || query}`, {
      extra: {
        query,
        organizationSlug,
        projectSlug: projectSlugOrId,
        inputQuery,
      },
    });
    output += "No issues found matching your search criteria.\n\n";
    output += "Try adjusting your search criteria or time range.";
    return output;
  }

  // Generate search URL for viewing results
  const searchUrl = getIssuesSearchUrl(
    resolvedHost,
    organizationSlug,
    query,
    projectSlugOrId,
    resolvedProtocol,
  );

  // Add view link with emoji and guidance text (like search_events)
  output += `**View these results in Sentry**:\n${searchUrl}\n`;
  output += `_Please share this link with the user to view the search results in their Sentry dashboard._\n\n`;

  output += `Found **${issues.length}** issue${issues.length === 1 ? "" : "s"}:\n\n`;

  // Format each issue
  issues.forEach((issue, index) => {
    // Generate issue URL using the utility function
    const issueUrl = getIssueUrl(
      resolvedHost,
      organizationSlug,
      issue.shortId,
      resolvedProtocol,
    );

    output += `## ${index + 1}. [${issue.shortId}](${issueUrl})\n\n`;
    output += `**${issue.title}**\n\n`;

    // Issue metadata
    // Issues don't have a level field in the API response
    output += `- **Status**: ${issue.status}\n`;
    // Display issue category for non-error types (feedback, performance, metric)
    if (issue.issueCategory && issue.issueCategory !== "error") {
      output += `- **Category**: ${issue.issueCategory}\n`;
    }
    output += `- **Users**: ${issue.userCount || 0}\n`;
    output += `- **Events**: ${issue.count || 0}\n`;

    if (issue.assignedTo) {
      const assignee = issue.assignedTo;
      if (typeof assignee === "string") {
        output += `- **Assigned to**: ${assignee}\n`;
      } else if (
        assignee &&
        typeof assignee === "object" &&
        "name" in assignee
      ) {
        output += `- **Assigned to**: ${assignee.name}\n`;
      }
    }

    output += `- **First seen**: ${formatDate(issue.firstSeen)}\n`;
    output += `- **Last seen**: ${formatDate(issue.lastSeen)}\n`;

    if (issue.culprit) {
      output += `- **Culprit**: \`${issue.culprit}\`\n`;
    }

    if (issue.seerFixabilityScore != null) {
      output += `- **Seer Actionability**: ${getSeerActionabilityLabel(issue.seerFixabilityScore)}\n`;
    }

    output += "\n";
  });

  // Add next steps section (like search_events)
  output += "## Next Steps\n\n";
  output +=
    "- Get more details about a specific issue: Use get_sentry_resource with the issue ID or issue URL\n";
  output +=
    "- Update issue status: Use update_issue to resolve or assign issues\n";
  output +=
    "- View event counts: Use search_events for aggregated statistics\n";

  // Add feedback-specific guidance if results contain feedback
  const hasFeedback = issues.some((i) => i.issueCategory === "feedback");
  if (hasFeedback) {
    output +=
      "- View feedback details: Use get_sentry_resource to see full feedback content and linked error events\n";
  }

  return output;
}

/**
 * Format date for display
 */
function formatDate(dateString?: string | null): string {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) {
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }
  return date.toISOString().split("T")[0];
}
