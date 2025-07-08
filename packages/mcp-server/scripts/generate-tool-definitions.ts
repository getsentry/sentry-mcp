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
 * Convert Zod schema object to JSON Schema
 */
function convertInputSchemaToJsonSchema(inputSchema: Record<string, any>) {
  if (!inputSchema || Object.keys(inputSchema).length === 0) {
    return {};
  }

  // Convert the inputSchema object to a Zod object schema, then to JSON Schema
  const zodObjectSchema = z.object(inputSchema);
  const jsonSchema = zodToJsonSchema(zodObjectSchema, {
    name: "ToolInputSchema",
    $refStrategy: "none", // Don't use $ref for cleaner output
  });

  // If there are definitions, extract from there, otherwise use direct properties
  if (jsonSchema.definitions?.ToolInputSchema?.properties) {
    return jsonSchema.definitions.ToolInputSchema.properties;
  }

  return jsonSchema.properties || {};
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
    const dtsContent = `declare const toolDefinitions: Array<{
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}>;
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
