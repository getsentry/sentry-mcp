import type { JSONSchema7 } from "json-schema";
import toolDefinitionsData from "./toolDefinitions.json";

// Tool parameter is just a JSON Schema v7 definition
export type ToolParameter = JSONSchema7;

// Tool definition with JSON Schema for each parameter
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, ToolParameter>;
}

// Type assertion - we trust the build process generates valid data
const toolDefinitions = toolDefinitionsData as ToolDefinition[];

export default toolDefinitions;
