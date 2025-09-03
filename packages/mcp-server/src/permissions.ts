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
 * All available scopes as a readonly list
 */
export function getAvailableScopes(): ReadonlyArray<Scope> {
  return Object.keys(SCOPE_HIERARCHY) as ReadonlyArray<Scope>;
}

/**
 * All scopes available in the server, generated from the permission hierarchy.
 * Exported here to keep scope consumers lightweight and avoid importing other
 * unrelated constants.
 */
export const ALL_SCOPES: ReadonlyArray<Scope> = getAvailableScopes();

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
