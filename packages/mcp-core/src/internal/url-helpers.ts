/**
 * Unified URL parsing utilities for Sentry resources.
 *
 * Parses Sentry URLs to identify resource types and extract relevant identifiers.
 * Supports issue, trace, profile, and event URLs across different Sentry URL formats
 * (subdomain, path-based organization, self-hosted).
 */

import { UserInputError } from "../errors";

/**
 * Types of Sentry resources that can be identified from URLs.
 */
export type SentryResourceType =
  | "issue"
  | "trace"
  | "profile"
  | "event"
  | "unknown";

/**
 * Result of parsing a Sentry URL.
 * Contains the resource type and all relevant identifiers extracted from the URL.
 */
export interface ParsedSentryUrl {
  /** The type of resource identified in the URL */
  type: SentryResourceType;
  /** Organization slug extracted from URL (subdomain or path) */
  organizationSlug: string;
  /** Issue ID (for issue and event URLs) */
  issueId?: string;
  /** Trace ID (for trace URLs) */
  traceId?: string;
  /** Event ID (for event URLs) */
  eventId?: string;
  /** Project slug (for profile URLs) */
  projectSlug?: string;
  /** Profiler ID (for profile URLs, from query param) */
  profilerId?: string;
  /** Start timestamp (for profile URLs, from query param) */
  start?: string;
  /** End timestamp (for profile URLs, from query param) */
  end?: string;
}

/**
 * Parses a Sentry URL and extracts resource type and identifiers.
 *
 * Supported URL patterns:
 * - Issue: `/issues/{issueId}` or `/organizations/{org}/issues/{issueId}`
 * - Event: `/issues/{issueId}/events/{eventId}`
 * - Trace: `/explore/traces/trace/{traceId}` or `/performance/trace/{traceId}`
 * - Profile: `/explore/profiling/profile/{project}/flamegraph/` with query params
 *
 * Organization slug is extracted from:
 * 1. Subdomain (e.g., `my-org.sentry.io`)
 * 2. Path (e.g., `/organizations/my-org/...` or `/my-org/issues/...`)
 *
 * @param url - A Sentry URL to parse
 * @returns Parsed URL with resource type and identifiers
 * @throws UserInputError if the URL is invalid or cannot be parsed
 *
 * @example
 * // Issue URL
 * parseSentryUrl("https://my-org.sentry.io/issues/PROJECT-123")
 * // { type: "issue", organizationSlug: "my-org", issueId: "PROJECT-123" }
 *
 * @example
 * // Profile URL
 * parseSentryUrl("https://my-org.sentry.io/explore/profiling/profile/my-project/flamegraph/?profilerId=abc123")
 * // { type: "profile", organizationSlug: "my-org", projectSlug: "my-project", profilerId: "abc123" }
 */
export function parseSentryUrl(url: string): ParsedSentryUrl {
  if (!url || typeof url !== "string") {
    throw new UserInputError(
      "Invalid Sentry URL. URL must be a non-empty string.",
    );
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new UserInputError(
      "Invalid Sentry URL. Must start with http:// or https://",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new UserInputError(`Invalid Sentry URL. Unable to parse URL: ${url}`);
  }

  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);

  // Extract organization slug first (needed for all resource types)
  const organizationSlug = extractOrganizationSlug(parsedUrl, pathParts);

  // Try to identify the resource type and extract relevant identifiers
  const result = identifyResource(parsedUrl, pathParts, organizationSlug);

  return result;
}

/**
 * Extracts organization slug from URL.
 *
 * Checks in order:
 * 1. `/organizations/{org}/...` path format
 * 2. `/{org}/issues/...` path format (org before known segments)
 * 3. Subdomain (e.g., `my-org.sentry.io`)
 */
function extractOrganizationSlug(parsedUrl: URL, pathParts: string[]): string {
  // Check for /organizations/{org}/ pattern
  if (pathParts.includes("organizations")) {
    const orgIndex = pathParts.indexOf("organizations");
    const slug = pathParts[orgIndex + 1];
    if (slug) {
      return slug;
    }
  }

  // Check for /{org}/issues/ or /{org}/explore/ pattern
  // Known top-level segments that indicate the first part is an org slug
  const knownSegments = [
    "issues",
    "explore",
    "performance",
    "projects",
    "settings",
  ];
  if (pathParts.length > 1 && knownSegments.includes(pathParts[1])) {
    return pathParts[0];
  }

  // Check for subdomain (e.g., my-org.sentry.io)
  const hostParts = parsedUrl.hostname.split(".");
  if (hostParts.length > 2 && hostParts[0] !== "www") {
    return hostParts[0];
  }

  // Self-hosted without clear org path: use first subdomain if available
  if (hostParts.length >= 2 && hostParts[0] !== "www") {
    // For self-hosted like sentry.mycompany.com/issues/123
    // the "sentry" subdomain is often the org
    return hostParts[0];
  }

  throw new UserInputError(
    "Invalid Sentry URL. Could not determine organization from URL.",
  );
}

/**
 * Identifies the resource type and extracts relevant identifiers.
 */
function identifyResource(
  parsedUrl: URL,
  pathParts: string[],
  organizationSlug: string,
): ParsedSentryUrl {
  // Profile URL: /explore/profiling/profile/{project}/flamegraph/
  // or /profiling/profile/{project}/flamegraph/
  const profilingIndex = pathParts.indexOf("profiling");
  if (profilingIndex !== -1 && pathParts[profilingIndex + 1] === "profile") {
    const projectSlug = pathParts[profilingIndex + 2];
    const profilerId = parsedUrl.searchParams.get("profilerId") || undefined;
    const start = parsedUrl.searchParams.get("start") || undefined;
    const end = parsedUrl.searchParams.get("end") || undefined;

    return {
      type: "profile",
      organizationSlug,
      projectSlug,
      profilerId,
      start,
      end,
    };
  }

  // Trace URL: /explore/traces/trace/{traceId} or /performance/trace/{traceId}
  const traceIndex = pathParts.indexOf("trace");
  if (traceIndex !== -1) {
    const traceId = pathParts[traceIndex + 1];
    if (traceId) {
      return {
        type: "trace",
        organizationSlug,
        traceId,
      };
    }
  }

  // Issue URL: /issues/{issueId} or with /events/{eventId}
  const issuesIndex = pathParts.indexOf("issues");
  if (issuesIndex !== -1) {
    const issueId = pathParts[issuesIndex + 1];
    if (issueId) {
      // Check for event URL: /issues/{issueId}/events/{eventId}
      const eventsIndex = pathParts.indexOf("events", issuesIndex);
      if (eventsIndex !== -1) {
        const eventId = pathParts[eventsIndex + 1];
        if (eventId) {
          return {
            type: "event",
            organizationSlug,
            issueId,
            eventId,
          };
        }
      }

      return {
        type: "issue",
        organizationSlug,
        issueId,
      };
    }
  }

  // Could not identify resource type
  return {
    type: "unknown",
    organizationSlug,
  };
}

/**
 * Checks if a URL appears to be a Sentry profile URL.
 *
 * @param url - URL to check
 * @returns True if the URL looks like a profile URL
 */
export function isProfileUrl(url: string): boolean {
  try {
    const parsed = parseSentryUrl(url);
    return parsed.type === "profile";
  } catch {
    return false;
  }
}
