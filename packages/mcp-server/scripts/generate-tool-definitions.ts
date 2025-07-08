#!/usr/bin/env tsx
/**
 * Generate tool definitions JSON file for client consumption.
 *
 * This script imports all tools from src/tools/index and exports their
 * definitions (name, description, inputSchema) with Zod schemas converted to JSON Schema.
 *
 * This file is used by the mcp-cloudflare client to display tool documentation
 * without importing server-side code that has Node.js dependencies.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import tools from the source directory
const tools = await import("../src/tools/index.js");

/**
 * Convert Zod schema object to JSON Schema properties
 */
function convertInputSchemaToJsonSchema(inputSchema: Record<string, any>) {
  if (!inputSchema || Object.keys(inputSchema).length === 0) {
    return {};
  }

  const properties: Record<string, any> = {};

  // Convert each individual Zod schema to JSON Schema
  for (const [key, zodSchema] of Object.entries(inputSchema)) {
    const jsonSchema = zodToJsonSchema(zodSchema, {
      $refStrategy: "none", // Don't use $ref for cleaner output
    });
    properties[key] = jsonSchema;
  }

  return properties;
}

/**
 * Generate tool definitions from imported tools.
 */
function generateToolDefinitions() {
  const toolsDefault = tools.default;

  if (!toolsDefault || typeof toolsDefault !== "object") {
    throw new Error("Failed to import tools from src/tools/index.js");
  }

  return Object.entries(toolsDefault).map(([key, tool]) => {
    if (!tool || typeof tool !== "object") {
      throw new Error(`Invalid tool: ${key}`);
    }

    const toolObj = tool as {
      name: string;
      description: string;
      inputSchema: Record<string, any>;
    };

    if (!toolObj.name || !toolObj.description) {
      throw new Error(`Tool ${key} is missing name or description`);
    }

    // Convert Zod schemas to JSON Schema
    const inputSchema = convertInputSchemaToJsonSchema(
      toolObj.inputSchema || {},
    );

    return {
      name: toolObj.name,
      description: toolObj.description,
      inputSchema,
    };
  });
}

/**
 * Main function to generate and write tool definitions.
 */
async function main() {
  try {
    console.log("Generating tool definitions...");

    const definitions = generateToolDefinitions();

    // Ensure dist directory exists
    const distDir = path.join(__dirname, "../dist");
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    // Write the definitions to JavaScript file
    const outputPath = path.join(distDir, "toolDefinitions.js");
    const jsContent = `export default ${JSON.stringify(definitions, null, 2)};`;
    fs.writeFileSync(outputPath, jsContent);

    // Write TypeScript declaration file
    const dtsPath = path.join(distDir, "toolDefinitions.d.ts");
    const dtsContent = `// JSON Schema property type definition
interface JsonSchemaProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: any;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

// Tool definition interface with proper JSON Schema types
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, JsonSchemaProperty>;
}

// Array of tool definitions with proper typing
type ToolDefinitions = ToolDefinition[];

declare const toolDefinitions: ToolDefinitions;
export default toolDefinitions;`;
    fs.writeFileSync(dtsPath, dtsContent);

    console.log(
      `✅ Generated tool definitions for ${definitions.length} tools`,
    );
    console.log(`📄 Output: ${outputPath}`);

    // Log summary of tools
    console.log("\nTools included:");
    definitions.forEach((def, index) => {
      const paramCount = Object.keys(def.inputSchema).length;
      console.log(`  ${index + 1}. ${def.name} (${paramCount} parameters)`);
    });
  } catch (error) {
    console.error("❌ Failed to generate tool definitions:", error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
