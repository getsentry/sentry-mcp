import toolDefinitionsData from "./toolDefinitions.json";
import type { Scope } from "./permissions";

// Tool definition for UI/external consumption
export interface ToolDefinition {
  name: string;
  description: string;
  // Full JSON Schema object for parameters
  inputSchema: unknown;
  // Sentry API scopes required to use the tool
  requiredScopes: Scope[];
}

const toolDefinitions = toolDefinitionsData as ToolDefinition[];

export default toolDefinitions;
