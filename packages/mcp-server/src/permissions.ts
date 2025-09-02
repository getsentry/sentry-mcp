/**
 * OAuth-style scope system for Sentry MCP Server
 *
 * Defines scopes for access control with hierarchical permissions.
 * Higher scopes include lower ones (e.g., write includes read).
 */

/**
 * Available scopes in the MCP server
 * These align with Sentry's API scopes where possible
 */
export type Scope =
  | "org:read" // Read organization information
  | "org:write" // Write organization information (includes read)
  | "org:admin" // Admin organization (includes write and read)
  | "project:read" // Read project information
  | "project:write" // Create/update projects (includes read)
  | "project:admin" // Delete projects (includes write and read)
  | "team:read" // Read team information
  | "team:write" // Create/update teams (includes read)
  | "team:admin" // Delete teams (includes write and read)
  | "member:read" // Read member information
  | "member:write" // Create/update members (includes read)
  | "member:admin" // Delete members (includes write and read)
  | "event:read" // Read events and issues
  | "event:write" // Update issues (includes read)
  | "event:admin" // Delete issues (includes write and read)
  | "project:releases"; // Access release endpoints

/**
 * Scope hierarchy - higher scopes include lower ones
 */
const SCOPE_HIERARCHY: Record<string, Set<Scope>> = {
  // Organization scopes
  "org:read": new Set(["org:read"]),
  "org:write": new Set(["org:read", "org:write"]),
  "org:admin": new Set(["org:read", "org:write", "org:admin"]),

  // Project scopes
  "project:read": new Set(["project:read"]),
  "project:write": new Set(["project:read", "project:write"]),
  "project:admin": new Set(["project:read", "project:write", "project:admin"]),

  // Team scopes
  "team:read": new Set(["team:read"]),
  "team:write": new Set(["team:read", "team:write"]),
  "team:admin": new Set(["team:read", "team:write", "team:admin"]),

  // Member scopes
  "member:read": new Set(["member:read"]),
  "member:write": new Set(["member:read", "member:write"]),
  "member:admin": new Set(["member:read", "member:write", "member:admin"]),

  // Event scopes
  "event:read": new Set(["event:read"]),
  "event:write": new Set(["event:read", "event:write"]),
  "event:admin": new Set(["event:read", "event:write", "event:admin"]),

  // Special scopes
  "project:releases": new Set(["project:releases"]),
};

/**
 * Expand a set of granted scopes to include all implied scopes
 */
export function expandScopes(grantedScopes: Set<Scope>): Set<Scope> {
  const expandedScopes = new Set<Scope>();

  for (const scope of grantedScopes) {
    const implied = SCOPE_HIERARCHY[scope];
    if (implied) {
      for (const s of implied) {
        expandedScopes.add(s);
      }
    } else {
      expandedScopes.add(scope);
    }
  }

  return expandedScopes;
}

/**
 * Permission levels that bundle scopes for the UI
 */
export enum PermissionLevel {
  READ_ONLY = "read_only",
  ISSUE_TRIAGE = "issue_triage",
  PROJECT_MANAGEMENT = "project_management",
}

/**
 * Map permission levels to their granted scopes
 * Note: These are the explicitly granted scopes, which will be expanded based on hierarchy
 */
export const PERMISSION_SCOPES: Record<PermissionLevel, Set<Scope>> = {
  [PermissionLevel.READ_ONLY]: new Set([
    "org:read",
    "project:read",
    "team:read",
    "event:read",
    "project:releases",
  ]),

  [PermissionLevel.ISSUE_TRIAGE]: new Set([
    "org:read",
    "project:read",
    "team:read",
    "event:write", // Includes event:read through hierarchy
    "project:releases",
  ]),

  [PermissionLevel.PROJECT_MANAGEMENT]: new Set([
    "org:read",
    "project:write", // Includes project:read through hierarchy
    "team:write", // Includes team:read through hierarchy
    "event:write", // Includes event:read through hierarchy
    "project:releases",
  ]),
};

/**
 * Human-readable descriptions of permission levels
 */
export const PERMISSION_DESCRIPTIONS: Record<PermissionLevel, string> = {
  [PermissionLevel.READ_ONLY]: "Read-only access to Sentry data",
  [PermissionLevel.ISSUE_TRIAGE]:
    "Read access plus issue management capabilities",
  [PermissionLevel.PROJECT_MANAGEMENT]:
    "Full access including project and team management",
};

/**
 * Human-readable descriptions of scopes
 */
export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "org:read": "View organization details",
  "org:write": "Modify organization details",
  "org:admin": "Delete organizations",
  "project:read": "View project information",
  "project:write": "Create and modify projects",
  "project:admin": "Delete projects",
  "team:read": "View team information",
  "team:write": "Create and modify teams",
  "team:admin": "Delete teams",
  "member:read": "View member information",
  "member:write": "Create and modify members",
  "member:admin": "Delete members",
  "event:read": "View events and issues",
  "event:write": "Update and manage issues",
  "event:admin": "Delete issues",
  "project:releases": "Access release information",
};

/**
 * Check if a set of scopes satisfies the required scopes
 */
export function hasRequiredScopes(
  grantedScopes: Set<Scope>,
  requiredScopes: Scope[],
): boolean {
  // Expand granted scopes to include implied scopes
  const expandedScopes = expandScopes(grantedScopes);
  return requiredScopes.every((scope) => expandedScopes.has(scope));
}

/**
 * Check if a tool is allowed based on granted scopes
 */
export function isToolAllowed(
  requiredScopes: Scope[] | undefined,
  grantedScopes: Set<Scope>,
): boolean {
  // If no scopes are required, tool is always allowed
  if (!requiredScopes || requiredScopes.length === 0) {
    return true;
  }

  return hasRequiredScopes(grantedScopes, requiredScopes);
}

/**
 * Get scopes for a permission level (with hierarchy expansion)
 */
export function getScopesForPermissionLevel(
  permissionLevel: PermissionLevel,
): Set<Scope> {
  const baseScopes =
    PERMISSION_SCOPES[permissionLevel] ||
    PERMISSION_SCOPES[PermissionLevel.READ_ONLY];
  return expandScopes(baseScopes);
}

/**
 * Parse permission level from string
 */
export function parsePermissionLevel(
  level: string | undefined,
): PermissionLevel {
  if (!level) {
    // Default to PROJECT_MANAGEMENT for backward compatibility
    return PermissionLevel.PROJECT_MANAGEMENT;
  }

  const normalizedLevel = level.toLowerCase().replace(/-/g, "_");

  if (normalizedLevel === "read_only" || normalizedLevel === "readonly") {
    return PermissionLevel.READ_ONLY;
  }
  if (normalizedLevel === "issue_triage" || normalizedLevel === "triage") {
    return PermissionLevel.ISSUE_TRIAGE;
  }
  if (
    normalizedLevel === "project_management" ||
    normalizedLevel === "management" ||
    normalizedLevel === "admin"
  ) {
    return PermissionLevel.PROJECT_MANAGEMENT;
  }

  // Default to PROJECT_MANAGEMENT for unknown values
  console.warn(
    `Unknown permission level: ${level}, defaulting to PROJECT_MANAGEMENT`,
  );
  return PermissionLevel.PROJECT_MANAGEMENT;
}

/**
 * Parse scopes from a comma-separated string
 */
export function parseScopesFromString(
  scopesString: string | undefined,
): Set<Scope> {
  if (!scopesString) {
    return new Set();
  }

  const scopes = scopesString
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as Scope[];

  return new Set(scopes);
}

/**
 * Get tool counts for each permission level
 * This would need to be calculated based on actual tool definitions
 */
export function getToolCountsForPermissionLevel(
  permissionLevel: PermissionLevel,
  tools: Array<{ requiredScopes?: Scope[] }>,
): number {
  const grantedScopes = getScopesForPermissionLevel(permissionLevel);
  return tools.filter((tool) =>
    isToolAllowed(tool.requiredScopes, grantedScopes),
  ).length;
}

/**
 * Legacy exports for backward compatibility
 */
export type ToolCategory = "read" | "triage" | "management" | "documentation";

// Dummy exports to maintain compatibility with metadata route
// These will be removed once we update the metadata route
export const TOOL_PERMISSIONS: Record<string, ToolCategory> = {};
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {};

export function getRequiredPermissionLevel(toolName: string): PermissionLevel {
  // This is now handled via scopes in tool definitions
  return PermissionLevel.READ_ONLY;
}

export function validateToolPermissions(availableTools: string[]): {
  valid: boolean;
  unknownTools: string[];
  unmappedTools: string[];
} {
  // This validation is now handled differently with scopes
  return {
    valid: true,
    unknownTools: [],
    unmappedTools: [],
  };
}

export function getAvailableTools(permissionLevel: PermissionLevel): string[] {
  // This would need to be calculated based on actual tool definitions
  return [];
}
