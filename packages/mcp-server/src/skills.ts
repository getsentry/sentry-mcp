/**
 * Skills: User-facing authorization system for MCP server capabilities
 *
 * Skills bundle related tools into functional capabilities that users can enable.
 * They coexist with traditional Sentry API scopes during the transition period.
 */

import { logIssue } from "./telem/logging";

// Skill type
export type Skill =
  | "inspect"
  | "triage"
  | "project-management"
  | "seer"
  | "docs";

// Central registry with metadata (used by OAuth UI)
export interface SkillDefinition {
  id: Skill;
  name: string;
  description: string;
  defaultEnabled: boolean;
  order: number;
  toolCount?: number; // Number of tools enabled by this skill (calculated dynamically)
}

export const SKILLS: Record<Skill, SkillDefinition> = {
  inspect: {
    id: "inspect",
    name: "Inspect Issues & Events",
    description: "Search for errors, analyze traces, and explore event details",
    defaultEnabled: true,
    order: 1,
  },
  seer: {
    id: "seer",
    name: "Seer",
    description:
      "Sentry's AI debugger that helps you analyze, root cause, and fix issues",
    defaultEnabled: true,
    order: 2,
  },
  docs: {
    id: "docs",
    name: "Documentation",
    description: "Search and read Sentry SDK documentation",
    defaultEnabled: false,
    order: 3,
  },
  triage: {
    id: "triage",
    name: "Triage Issues",
    description: "Resolve, assign, and update issues",
    defaultEnabled: false,
    order: 4,
  },
  "project-management": {
    id: "project-management",
    name: "Manage Projects & Teams",
    description: "Create and modify projects, teams, and DSNs",
    defaultEnabled: false,
    order: 5,
  },
};

// Sorted array for UI ordering (without tool counts yet)
const SKILLS_ARRAY_BASE = Object.values(SKILLS).sort(
  (a, b) => a.order - b.order,
);

// Calculate tool counts per skill (lazy-loaded to avoid circular dependency)
let cachedToolCounts: Map<Skill, number> | null = null;
let toolCountsPromise: Promise<Map<Skill, number>> | null = null;

async function getToolCounts(): Promise<Map<Skill, number>> {
  // Return cached result if available
  if (cachedToolCounts) return cachedToolCounts;

  // If already computing, wait for that computation to complete (prevents race condition)
  if (toolCountsPromise) return toolCountsPromise;

  // Start computation and cache the promise
  toolCountsPromise = (async () => {
    try {
      // Dynamically import tools to count them
      const toolsModule = await import("./tools");
      const tools = toolsModule.default;

      const counts = new Map<Skill, number>();

      // Initialize counts
      for (const skill of Object.keys(SKILLS)) {
        counts.set(skill as Skill, 0);
      }

      // Count tools for each skill
      for (const tool of Object.values(tools)) {
        // Type guard: verify this is a valid tool with requiredSkills
        if (
          typeof tool === "object" &&
          tool !== null &&
          "requiredSkills" in tool &&
          Array.isArray(tool.requiredSkills)
        ) {
          for (const skill of tool.requiredSkills) {
            if (counts.has(skill as Skill)) {
              counts.set(skill as Skill, (counts.get(skill as Skill) || 0) + 1);
            }
          }
        }
      }

      cachedToolCounts = counts;
      return counts;
    } catch (error) {
      // Log error for debugging
      logIssue(error, {
        loggerScope: ["skills", "tool-counts"],
        extra: {
          context: "Failed to calculate tool counts for skills",
        },
      });

      // Clear promise cache on error so next call will retry
      toolCountsPromise = null;
      throw error;
    }
  })();

  return toolCountsPromise;
}

// Helper function to get SKILLS_ARRAY with tool counts
let skillsArrayWithCounts: SkillDefinition[] | null = null;
let skillsArrayPromise: Promise<SkillDefinition[]> | null = null;

export async function getSkillsArrayWithCounts(): Promise<SkillDefinition[]> {
  // Return cached result if available
  if (skillsArrayWithCounts) return skillsArrayWithCounts;

  // If already computing, wait for that computation to complete (prevents race condition)
  if (skillsArrayPromise) return skillsArrayPromise;

  // Start computation and cache the promise
  skillsArrayPromise = (async () => {
    try {
      const toolCounts = await getToolCounts();
      skillsArrayWithCounts = SKILLS_ARRAY_BASE.map((skill) => ({
        ...skill,
        toolCount: toolCounts.get(skill.id) || 0,
      }));

      return skillsArrayWithCounts;
    } catch (error) {
      // Log error for debugging
      logIssue(error, {
        loggerScope: ["skills", "skills-array"],
        extra: {
          context: "Failed to build skills array with tool counts",
        },
      });

      // Clear promise cache on error so next call will retry
      skillsArrayPromise = null;
      throw error;
    }
  })();

  return skillsArrayPromise;
}

// Export SKILLS_ARRAY without tool counts (for synchronous access)
// Use getSkillsArrayWithCounts() when you need tool counts
export const SKILLS_ARRAY: SkillDefinition[] = SKILLS_ARRAY_BASE;

// All skills (for foundational tools that should be available to all skills)
export const ALL_SKILLS: Skill[] = Object.keys(SKILLS) as Skill[];

// Default skills
export const DEFAULT_SKILLS: Skill[] = SKILLS_ARRAY.filter(
  (s) => s.defaultEnabled,
).map((s) => s.id);

// Validation
export function isValidSkill(skill: string): skill is Skill {
  return skill in SKILLS;
}

// Check if tool is enabled by skills
export function hasRequiredSkills(
  grantedSkills: Set<Skill> | undefined,
  requiredSkills: Skill[],
): boolean {
  if (!grantedSkills || requiredSkills.length === 0) return false;
  return requiredSkills.some((skill) => grantedSkills.has(skill));
}

// Parse and validate skills from input
export function parseSkills(input: unknown): {
  valid: Set<Skill>;
  invalid: string[];
} {
  const valid = new Set<Skill>();
  const invalid: string[] = [];

  if (!input) return { valid, invalid };

  // Parse skills from string (comma-separated) or array (from JSON)
  let skills: string[] = [];
  if (typeof input === "string") {
    skills = input.split(",");
  } else if (Array.isArray(input)) {
    skills = input.map((v) => (typeof v === "string" ? v : ""));
  }

  for (const skill of skills) {
    const trimmed = String(skill).trim();
    if (isValidSkill(trimmed)) {
      valid.add(trimmed);
    } else if (trimmed) {
      invalid.push(trimmed);
    }
  }

  return { valid, invalid };
}

// Calculate required scopes from granted skills
export async function getScopesForSkills(
  grantedSkills: Set<Skill>,
): Promise<Set<string>> {
  // Import here to avoid circular dependency at module load time
  const { DEFAULT_SCOPES } = await import("./constants.js");
  const toolsModule = await import("./tools/index.js");
  const tools = toolsModule.default;

  const scopes = new Set<string>(DEFAULT_SCOPES);

  // Iterate through all tools and collect required scopes for tools enabled by granted skills
  for (const tool of Object.values(tools)) {
    // Check if any of the tool's required skills are granted
    const toolEnabled = tool.requiredSkills.some((reqSkill) =>
      grantedSkills.has(reqSkill),
    );

    // If tool is enabled by granted skills, add its required scopes
    if (toolEnabled) {
      for (const scope of tool.requiredScopes) {
        scopes.add(scope);
      }
    }
  }

  return scopes;
}
