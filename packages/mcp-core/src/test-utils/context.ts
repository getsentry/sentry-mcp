import type { ServerContext } from "../types";
import { SKILLS, type Skill } from "../skills";

/**
 * Create a test context with default values for testing tools
 */
export function createTestContext(
  overrides: Partial<ServerContext> = {},
): ServerContext {
  // Default to all skills for testing
  const allSkills = Object.keys(SKILLS) as Skill[];
  return {
    accessToken: "test-access-token",
    constraints: {},
    grantedSkills: new Set<Skill>(allSkills),
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
