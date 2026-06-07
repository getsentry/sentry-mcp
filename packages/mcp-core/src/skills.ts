/**
 * Skills: User-facing authorization system for MCP server capabilities
 *
 * Skills bundle related tools into functional capabilities that users can enable.
 * They coexist with traditional Sentry API scopes during the transition period.
 */

// Skill type
export type Skill =
  | "inspect"
  | "triage"
  | "project-management"
  | "seer"
  | "docs"
  | "preprod";

// Central registry with metadata (used by OAuth UI)
export interface SkillDefinition {
  id: Skill;
  name: string;
  description: string;
  defaultEnabled: boolean;
  order: number;
  toolCount?: number; // Number of tools enabled by this skill (calculated dynamically)
  /**
   * Experimental-mode consolidation target. When set, tools assigned to this
   * skill are also exposed to sessions granted the target skill, and OAuth
   * consent can hide the source skill to keep the visible permission set small.
   */
  mergedIntoSkillInExperimentalMode?: Skill;
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
  preprod: {
    id: "preprod",
    name: "Preprod Snapshots",
    description:
      "Inspect visual regression snapshot tests from CI — view changed images and diff masks",
    defaultEnabled: false,
    order: 6,
    mergedIntoSkillInExperimentalMode: "inspect",
  },
};

// Sorted array for UI ordering
export const SKILLS_ARRAY: SkillDefinition[] = Object.values(SKILLS).sort(
  (a, b) => a.order - b.order,
);

// Get skills with tool counts (used by build script only)
export async function getSkillsArrayWithCounts(): Promise<SkillDefinition[]> {
  // Dynamically import to avoid circular dependency
  const toolsModule = await import("./tools");
  const surfacesModule = await import("./tools/surfaces");
  const tools = toolsModule.default;
  const isCatalogInfrastructureTool =
    surfacesModule.isCatalogInfrastructureToolName;
  const isWrapperTool = surfacesModule.isWrapperToolName;

  const counts = new Map<Skill, number>();

  // Initialize counts
  for (const skill of Object.keys(SKILLS)) {
    counts.set(skill as Skill, 0);
  }

  // Count tools for each skill
  for (const [toolName, tool] of Object.entries(tools)) {
    if (isWrapperTool(toolName) || isCatalogInfrastructureTool(toolName)) {
      continue;
    }
    if (Array.isArray(tool.skills)) {
      for (const skill of tool.skills) {
        counts.set(skill as Skill, (counts.get(skill as Skill) || 0) + 1);
      }
    }
  }

  return SKILLS_ARRAY.map((skill) => ({
    ...skill,
    toolCount: counts.get(skill.id) || 0,
  }));
}

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

export interface SkillModeOptions {
  experimentalMode?: boolean;
}

// Expand tool skills based on active server mode.
export function getEffectiveToolSkills(
  toolSkills: Skill[],
  options: SkillModeOptions = {},
): Skill[] {
  if (!options.experimentalMode) {
    return toolSkills;
  }

  const effectiveSkills = new Set<Skill>(toolSkills);
  for (const skill of toolSkills) {
    const mergedSkill = SKILLS[skill]?.mergedIntoSkillInExperimentalMode;
    if (mergedSkill) {
      effectiveSkills.add(mergedSkill);
    }
  }

  return Array.from(effectiveSkills);
}

// Check if tool is enabled by granted skills (ANY match = enabled)
export function isEnabledBySkills(
  grantedSkills: Set<Skill> | undefined,
  toolSkills: Skill[],
  options: SkillModeOptions = {},
): boolean {
  if (!grantedSkills || toolSkills.length === 0) return false;
  return getEffectiveToolSkills(toolSkills, options).some((skill) =>
    grantedSkills.has(skill),
  );
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
  options: SkillModeOptions = {},
): Promise<Set<string>> {
  // Import here to avoid circular dependency at module load time
  const { DEFAULT_SCOPES } = await import("./constants.js");
  const toolsModule = await import("./tools/index.js");
  const surfacesModule = await import("./tools/surfaces.js");
  const tools = toolsModule.default;
  const isCatalogInfrastructureTool =
    surfacesModule.isCatalogInfrastructureToolName;
  const isWrapperTool = surfacesModule.isWrapperToolName;

  const scopes = new Set<string>(DEFAULT_SCOPES);

  // Iterate through all tools and collect required scopes for tools enabled by granted skills
  for (const [toolName, tool] of Object.entries(tools)) {
    if (isWrapperTool(toolName) || isCatalogInfrastructureTool(toolName)) {
      continue;
    }
    // Check if any of the tool's skills are granted
    const toolEnabled = getEffectiveToolSkills(tool.skills, options).some(
      (skill) => grantedSkills.has(skill),
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
