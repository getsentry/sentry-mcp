#!/usr/bin/env tsx
/**
 * Generate tool definitions JSON file for client consumption.
 *
 * This script imports all tools from src/tools/index and exports their
 * definitions (name, description, inputSchema) with Zod schemas converted to JSON Schema.
 *
 * This file is used by the mcp-cloudflare client to display tool documentation
 * without importing server-side code that has Node.js dependencies.
 *
 * Note: In dev mode, this script runs once at startup. If you modify tool definitions,
 * you'll need to restart the dev server to regenerate this file.
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
const tools = await import("../src/tools/index.ts");

/**
 * Convert Zod schema object to simplified parameter definitions
 * Only extracts description since that's all the UI needs
 */
function convertInputSchemaToSimplified(inputSchema: Record<string, any>) {
  if (!inputSchema || Object.keys(inputSchema).length === 0) {
    return {};
  }

  const properties: Record<string, any> = {};

  // Extract only the description from each Zod schema
  for (const [key, zodSchema] of Object.entries(inputSchema)) {
    // Get the full JSON Schema to extract description
    const jsonSchema = zodToJsonSchema(zodSchema, {
      $refStrategy: "none",
    });

    // Only include description field for UI display
    properties[key] = {
      description: jsonSchema.description || "",
    };
  }

  return properties;
}

/**
 * Generate tool definitions from imported tools.
 */
function generateToolDefinitions() {
  const toolsDefault = tools.default;

  if (!toolsDefault || typeof toolsDefault !== "object") {
    throw new Error("Failed to import tools from src/tools/index.ts");
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

    // Convert Zod schemas to simplified format for UI
    const inputSchema = convertInputSchemaToSimplified(
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

    // Write the definitions to JSON file in src directory for prebuild bundling
    const outputPath = path.join(__dirname, "../src/toolDefinitions.json");
    fs.writeFileSync(outputPath, JSON.stringify(definitions, null, 2));

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
