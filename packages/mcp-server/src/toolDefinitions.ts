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
}

// Type assertion - we trust the build process generates valid data
const toolDefinitions = toolDefinitionsData as ToolDefinition[];

export default toolDefinitions;
