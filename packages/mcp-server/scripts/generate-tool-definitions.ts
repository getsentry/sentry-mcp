#!/usr/bin/env tsx
/**
 * Generate tool definitions JSON file for client consumption.
 *
 * This script imports all tools from src/tools/index and extracts their
 * name, description, and parameter schema descriptions to generate a
 * toolDefinitions.json file in the dist directory.
 *
 * This file is used by the mcp-cloudflare client to display tool documentation
 * without importing server-side code that has Node.js dependencies.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import tools from the source directory
const tools = await import("../src/tools/index.js");

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<
    string,
    {
      description: string;
      required: boolean;
      type?: string;
    }
  >;
}

/**
 * Extract schema descriptions from Zod schemas.
 *
 * This function recursively extracts description metadata from Zod schemas,
 * handling optional schemas and nested types.
 */
function extractSchemaDescriptions(
  schema: Record<string, unknown>,
): Record<string, { description: string; required: boolean; type?: string }> {
  if (!schema || typeof schema !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(schema).map(([key, zodSchema]) => {
      let description = "";
      let required = true;
      let type: string | undefined;

      if (zodSchema && typeof zodSchema === "object") {
        // Type assertion for Zod schema shape
        const schemaObj = zodSchema as {
          description?: string;
          _def?: {
            innerType?: {
              description?: string;
              typeName?: string;
            };
            typeName?: string;
          };
          isOptional?: () => boolean;
        };

        // Extract description from the schema
        description = schemaObj.description || "";

        // Check if this is an optional schema
        if (schemaObj._def) {
          // For optional schemas, check the inner type
          if (schemaObj._def.innerType) {
            description =
              description || schemaObj._def.innerType.description || "";
            required = false;
            type = getZodTypeName(schemaObj._def.innerType.typeName);
          } else {
            type = getZodTypeName(schemaObj._def.typeName);
          }
        }

        // Some schemas might have isOptional method
        if (typeof schemaObj.isOptional === "function") {
          try {
            required = !schemaObj.isOptional();
          } catch {
            // If isOptional throws, assume required
            required = true;
          }
        }
      }

      return [
        key,
        {
          description,
          required,
          ...(type && { type }),
        },
      ];
    }),
  );
}

/**
 * Convert Zod type names to more readable type names.
 */
function getZodTypeName(typeName?: string): string | undefined {
  if (!typeName) return undefined;

  switch (typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return "array";
    case "ZodObject":
      return "object";
    case "ZodEnum":
      return "enum";
    case "ZodUnion":
      return "union";
    case "ZodLiteral":
      return "literal";
    default:
      return typeName;
  }
}

/**
 * Generate tool definitions from imported tools.
 */
function generateToolDefinitions(): ToolDefinition[] {
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
      inputSchema: Record<string, unknown>;
    };

    if (!toolObj.name || !toolObj.description) {
      throw new Error(`Tool ${key} is missing name or description`);
    }

    return {
      name: toolObj.name,
      description: toolObj.description,
      inputSchema: extractSchemaDescriptions(toolObj.inputSchema || {}),
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
  inputSchema: Record<string, {
    description: string;
    required: boolean;
    type?: string;
  }>;
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
