/**
 * Extracts the Sentry issue ID and organization slug from a full URL
 *
 * @param url - A full Sentry issue URL
 * @returns Object containing the numeric issue ID and organization slug (if found)
 * @throws Error if the input is invalid
 */
export function extractIssueId(url: string): {
  issueId: string;
  organizationSlug: string;
} {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(
      "Invalid Sentry issue URL. Must start with http:// or https://",
    );
  }

  const parsedUrl = new URL(url);

  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2 || !pathParts.includes("issues")) {
    throw new Error(
      "Invalid Sentry issue URL. Path must contain '/issues/{issue_id}'",
    );
  }

  const issueId = pathParts[pathParts.indexOf("issues") + 1];
  if (!issueId) {
    throw new Error("Unable to determine issue ID from URL.");
  }

  // Extract organization slug from either the path or subdomain
  let organizationSlug: string | undefined;
  if (pathParts.includes("organizations")) {
    organizationSlug = pathParts[pathParts.indexOf("organizations") + 1];
  } else if (pathParts.length > 1 && pathParts[0] !== "issues") {
    // If URL is like sentry.io/sentry/issues/123
    organizationSlug = pathParts[0];
  } else {
    // Check for subdomain
    const hostParts = parsedUrl.hostname.split(".");
    if (hostParts.length > 2 && hostParts[0] !== "www") {
      organizationSlug = hostParts[0];
    }
  }

  if (!organizationSlug) {
    throw new Error(
      "Invalid Sentry issue URL. Could not determine organization.",
    );
  }

  return { issueId, organizationSlug };
}
