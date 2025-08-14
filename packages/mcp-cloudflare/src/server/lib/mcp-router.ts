/**
 * MCP Router - Handles dynamic URL patterns for organization/project constraints
 *
 * Parses URL patterns like:
 * - /mcp -> No constraints
 * - /mcp/{organizationSlug} -> Organization constraint
 * - /mcp/{organizationSlug}/{projectSlug} -> Organization + project constraints
 */
export interface ParsedMcpPath {
  basePath: string;
  constraints?: {
    organizationSlug?: string;
    projectSlug?: string;
  };
}

/**
 * Parses an MCP path to extract constraints.
 *
 * @param pathname - The URL pathname (e.g., "/mcp/acme-corp/frontend")
 * @returns Parsed path with constraints
 */
export function parseMcpPath(pathname: string): ParsedMcpPath | null {
  // Remove trailing slash
  const cleanPath = pathname.replace(/\/$/, "");
  const segments = cleanPath.split("/").filter(Boolean);

  // Handle SSE endpoints
  if (segments[0] === "sse") {
    if (segments.length === 1) {
      // /sse - no constraints
      return { basePath: "/sse" };
    }

    if (segments.length === 2) {
      // /sse/{organizationSlug}
      return {
        basePath: "/sse",
        constraints: {
          organizationSlug: segments[1],
        },
      };
    }

    if (segments.length === 3) {
      // /sse/{organizationSlug}/{projectSlug}
      return {
        basePath: "/sse",
        constraints: {
          organizationSlug: segments[1],
          projectSlug: segments[2],
        },
      };
    }

    // Too many segments or invalid pattern
    return null;
  }

  // Handle MCP endpoints
  if (segments[0] === "mcp") {
    if (segments.length === 1) {
      // /mcp - no constraints
      return { basePath: "/mcp" };
    }

    if (segments.length === 2) {
      // /mcp/{organizationSlug}
      return {
        basePath: "/mcp",
        constraints: {
          organizationSlug: segments[1],
        },
      };
    }

    if (segments.length === 3) {
      // /mcp/{organizationSlug}/{projectSlug}
      return {
        basePath: "/mcp",
        constraints: {
          organizationSlug: segments[1],
          projectSlug: segments[2],
        },
      };
    }
  }

  // Too many segments or invalid pattern
  return null;
}
