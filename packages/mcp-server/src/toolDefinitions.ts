// Re-export the generated tool definitions JSON
import toolDefinitionsData from "./toolDefinitions.json";

// Type definition for a tool parameter
export interface ToolParameter {
  type?: string;
  description?: string;
  anyOf?: any[];
  $schema?: string;
  enum?: string[];
  [key: string]: any;
}

// Type definition for a tool
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, ToolParameter>;
}

// Type the imported JSON data
const toolDefinitions: ToolDefinition[] = toolDefinitionsData;

export default toolDefinitions;
