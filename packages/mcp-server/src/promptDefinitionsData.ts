import promptDefinitionsData from "./promptDefinitions.json";

export interface PromptDefinitionData {
  name: string;
  description: string;
  // Full JSON Schema object for parameters (uniform key)
  inputSchema: unknown;
}

const promptDefinitions = promptDefinitionsData as PromptDefinitionData[];

export default promptDefinitions;
