import toolDefinitionsData from "./toolDefinitions.json";

// Simplified tool parameter with just description for UI display
export interface ToolParameter {
  description: string;
}

// Tool definition for UI consumption
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, ToolParameter>;
  requiredScopes: string[];
}

// Normalize data to ensure requiredScopes exists for all tools
const toolDefinitions = (
  toolDefinitionsData as unknown as Array<
    ToolDefinition & { requiredScopes?: string[] }
  >
).map((def) => ({
  ...def,
  requiredScopes: Array.isArray(def.requiredScopes) ? def.requiredScopes : [],
}));

export default toolDefinitions;
