import type { ServerContext } from "../types";
import type { Scope } from "../permissions";

/**
 * Create a test context with default values for testing tools
 */
export function createTestContext(
  overrides: Partial<ServerContext> = {},
): ServerContext {
  return {
    accessToken: "test-access-token",
    constraints: {},
    grantedScopes: new Set<Scope>([
      "org:read",
      "project:write",
      "team:write",
      "event:write",
    ]),
    ...overrides,
  };
}

/**
 * Create a test context with specific constraints
 */
export function createTestContextWithConstraints(
  constraints: ServerContext["constraints"],
  overrides: Partial<ServerContext> = {},
): ServerContext {
  return createTestContext({
    constraints,
    ...overrides,
  });
}
