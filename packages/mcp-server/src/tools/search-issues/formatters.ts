import type { Issue } from "../../api-client";
import { getIssueUrl, getIssuesSearchUrl } from "../../utils/url-utils";

/**
 * Format issue search results for display
 */
export function formatIssueResults(
  issues: Issue[],
  organizationSlug: string,
  projectSlugOrId: string | undefined,
  query: string,
  regionUrl?: string,
): string {
  const host = regionUrl ? new URL(regionUrl).host : "sentry.io";

  let output = `# Issues in **${organizationSlug}`;
  if (projectSlugOrId) {
    output += `/${projectSlugOrId}`;
  }
  output += "**\n\n";

  if (issues.length === 0) {
    output += "No issues found matching your search criteria.\n\n";
    output += `**Query**: \`${query}\`\n\n`;
    output += "Try adjusting your search criteria or time range.";
    return output;
  }

  output += `Found **${issues.length}** issue${issues.length === 1 ? "" : "s"}:\n\n`;

  // Format each issue
  issues.forEach((issue, index) => {
    // Generate issue URL using the utility function
    const issueUrl = getIssueUrl(host, organizationSlug, issue.shortId);

    output += `## ${index + 1}. [${issue.shortId}](${issueUrl})\n\n`;
    output += `**${issue.title}**\n\n`;

    // Issue metadata
    // Issues don't have a level field in the API response
    output += `- **Status**: ${issue.status}\n`;
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

    output += "\n";
  });

  // Add search link
  const searchUrl = getIssuesSearchUrl(
    host,
    organizationSlug,
    query,
    projectSlugOrId,
  );
  output += `[View in Sentry Issues](${searchUrl})\n\n`;

  output += "<!-- display as issue cards -->";

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
  return date.toLocaleDateString();
}
