#!/usr/bin/env tsx
/**
 * Generate TypeScript type definitions alongside the JSON file.
 * This creates a .d.ts file that provides proper typing for the generated JSON.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the generated JSON to extract tool names
const toolDefinitions = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../src/toolDefinitions.json"), "utf-8"),
);

/**
 * Generate TypeScript declaration file for the JSON
 */
function generateTypeDeclarations() {
  const toolNames = toolDefinitions
    .map((tool: any) => `"${tool.name}"`)
    .join(" | ");

  const declarations = `// This file is auto-generated
// Do not edit manually

/**
 * JSON Schema type definition
 */
export interface JsonSchema {
  type?: string;
  description?: string;
  enum?: readonly string[];
  anyOf?: readonly JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  default?: any;
  $schema?: string;
  not?: JsonSchema | Record<string, never>;
  [key: string]: any;
}

/**
 * Tool definition with properly typed schema
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, JsonSchema>;
}

/**
 * Literal union type of all tool names
 */
export type ToolName = ${toolNames};

/**
 * The actual tool definitions from the JSON file
 */
declare const toolDefinitions: ToolDefinition[];

export default toolDefinitions;
`;

  return declarations;
}

async function main() {
  try {
    console.log("Generating TypeScript declarations for tool definitions...");

    const declarations = generateTypeDeclarations();

    // Write declarations next to the JSON file
    const outputPath = path.join(__dirname, "../src/toolDefinitions.json.d.ts");
    fs.writeFileSync(outputPath, declarations);

    console.log(`✅ Generated TypeScript declarations`);
    console.log(`📄 Output: ${outputPath}`);
  } catch (error) {
    console.error("❌ Failed to generate type declarations:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
