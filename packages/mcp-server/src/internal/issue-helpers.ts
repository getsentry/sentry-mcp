/**
 * Issue parameter parsing and validation utilities.
 *
 * Handles flexible input formats for Sentry issues (URLs vs explicit parameters),
 * extracts organization and issue identifiers, and validates issue ID formats.
 * Provides robust parsing for LLM-generated parameters that may contain formatting
 * inconsistencies.
 */

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
  if (!url || typeof url !== "string") {
    throw new Error(
      "Invalid Sentry issue URL. URL must be a non-empty string.",
    );
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(
      "Invalid Sentry issue URL. Must start with http:// or https://",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error(`Invalid Sentry issue URL. Unable to parse URL: ${url}`);
  }

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

/**
 * Sometimes the LLM will pass in a funky issue shortId. For example it might pass
 * in "CLOUDFLARE-MCP-41." instead of "CLOUDFLARE-MCP-41". This function attempts to
 * fix common issues.
 *
 * @param issueId - The issue ID to parse
 * @returns The parsed issue ID
 */
export function parseIssueId(issueId: string) {
  let finalIssueId = issueId;
  // remove trailing punctuation
  finalIssueId = finalIssueId.replace(/[^\w-]/g, "");

  // Validate against common Sentry issue ID patterns
  // Either numeric IDs or PROJECT-ABC123 format
  const validFormatRegex = /^(\d+|[A-Za-z][\w-]*-[A-Za-z0-9]+)$/;

  if (!validFormatRegex.test(finalIssueId)) {
    throw new Error(
      `Invalid issue ID format: "${finalIssueId}". Expected either a numeric ID or a project code followed by an alphanumeric identifier (e.g., "PROJECT-ABC123").`,
    );
  }

  return finalIssueId;
}

/**
 * Parses issue parameters from a variety of formats.
 *
 * @param params - Object containing issue URL, issue ID, and organization slug
 * @returns Object containing the parsed organization slug and issue ID
 * @throws Error if the input is invalid
 */
export function parseIssueParams({
  issueUrl,
  issueId,
  organizationSlug,
}: {
  issueUrl?: string | null;
  issueId?: string | null;
  organizationSlug?: string | null;
}): {
  organizationSlug: string;
  issueId: string;
} {
  if (issueUrl) {
    const resolved = extractIssueId(issueUrl);
    if (!resolved) {
      throw new Error(
        "Invalid Sentry issue URL. Path should contain '/issues/{issue_id}'",
      );
    }
    return {
      ...resolved,
      issueId: parseIssueId(resolved.issueId),
    };
  }

  if (!organizationSlug) {
    throw new Error("Organization slug is required");
  }

  if (issueId) {
    return {
      organizationSlug,
      issueId: parseIssueId(issueId),
    };
  }

  throw new Error("Either issueId or issueUrl must be provided");
}
