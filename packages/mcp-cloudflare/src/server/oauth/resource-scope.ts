/**
 * Parse RFC 8707 `resource` URLs that scope this MCP deployment to an org/project.
 * Example: https://example.com/mcp/my-org/backend
 */
export function parseResourceMcpConstraints(
  resource: string | null | undefined,
): { organizationSlug: string; projectSlug: string | null } | null {
  if (!resource) {
    return null;
  }

  try {
    const { pathname } = new URL(resource);
    const pathSegments = pathname.split("/").filter(Boolean);

    if (pathSegments[0] !== "mcp") {
      return null;
    }

    if (pathSegments.length === 2) {
      return {
        organizationSlug: pathSegments[1],
        projectSlug: null,
      };
    }

    if (pathSegments.length === 3) {
      return {
        organizationSlug: pathSegments[1],
        projectSlug: pathSegments[2],
      };
    }

    return null;
  } catch {
    return null;
  }
}
