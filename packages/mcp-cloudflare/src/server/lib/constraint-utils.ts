import type { UrlConstraints } from "@sentry/mcp-server/types";
import { isValidSlug } from "./slug-validation";

/**
 * Check if a pathname is a reserved MCP protocol endpoint
 */
export function isReservedEndpoint(pathname: string): boolean {
  const reservedEndpoints = ["/sse/message", "/mcp/message"];

  return reservedEndpoints.some(
    (endpoint) => pathname === endpoint || pathname.startsWith(`${endpoint}?`),
  );
}

/**
 * Extract constraints using URLPattern for flexible routing
 * Supports: /mcp, /mcp/:org, /mcp/:org/:project
 */
export function extractConstraintsWithURLPattern(
  url: string,
  patternString: string,
): UrlConstraints & { error?: string } {
  try {
    // Handle reserved SSE protocol endpoints first
    const urlObj = new URL(url);
    if (isReservedEndpoint(urlObj.pathname)) {
      return { organizationSlug: null, projectSlug: null };
    }

    // Create URLPattern for flexible matching
    // Support multiple patterns: /mcp, /mcp/:org, /mcp/:org/:project
    const pattern = new URLPattern({ pathname: patternString });

    // Try to match and extract parameters
    const result = pattern.exec(url);

    if (!result) {
      // URL doesn't match pattern - could be valid for some endpoints
      return { organizationSlug: null, projectSlug: null };
    }

    // Extract named parameters from URLPattern groups
    const { groups } = result.pathname;
    const org = groups?.org || null;
    const project = groups?.project || null;

    // Validate slugs if present
    if (org && !isValidSlug(org)) {
      return {
        organizationSlug: null,
        projectSlug: null,
        error: "Invalid organization slug format",
      };
    }

    if (project && !isValidSlug(project)) {
      return {
        organizationSlug: null,
        projectSlug: null,
        error: "Invalid project slug format",
      };
    }

    return {
      organizationSlug: org,
      projectSlug: project,
    };
  } catch (error) {
    console.error("[MCP Agent] URLPattern error:", error);
    return {
      organizationSlug: null,
      projectSlug: null,
      error: "Invalid URL pattern",
    };
  }
}
