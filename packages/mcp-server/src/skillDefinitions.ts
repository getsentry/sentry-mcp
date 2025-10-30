import skillDefinitionsData from "./skillDefinitions.json";

// Skill definition for UI/external consumption
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  order: number;
  toolCount?: number;
}

const skillDefinitions = skillDefinitionsData as SkillDefinition[];

export default skillDefinitions;
