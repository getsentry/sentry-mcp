#!/usr/bin/env tsx
/**
 * Generate tool and skill definitions JSON for external consumption.
 *
 * Outputs to src/ so they can be bundled and imported by clients and the Cloudflare app.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lazy imports of server modules to avoid type bleed
const toolsModule = await import("../src/tools/index.ts");
const skillsModule = await import("../src/skills.ts");

function writeJson(file: string, data: unknown) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureDirExists(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Shared helpers for Zod parameter maps
function zodFieldMapToDescriptions(
  fieldMap: Record<string, ZodTypeAny>,
): Record<string, { description: string }> {
  const out: Record<string, { description: string }> = {};
  for (const [key, schema] of Object.entries(fieldMap)) {
    const js = zodToJsonSchema(schema, { $refStrategy: "none" }) as {
      description?: string;
    };
    out[key] = { description: js.description || "" };
  }
  return out;
}

function zodFieldMapToJsonSchema(
  fieldMap: Record<string, ZodTypeAny>,
): unknown {
  if (!fieldMap || Object.keys(fieldMap).length === 0) return {};
  const obj = z.object(fieldMap);
  return zodToJsonSchema(obj, { $refStrategy: "none" });
}

function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name);
}

// Tools
function generateToolDefinitions() {
  const toolsDefault = toolsModule.default as
    | Record<string, unknown>
    | undefined;
  if (!toolsDefault || typeof toolsDefault !== "object") {
    throw new Error("Failed to import tools from src/tools/index.ts");
  }

  const defs = Object.entries(toolsDefault).map(([key, tool]) => {
    if (!tool || typeof tool !== "object")
      throw new Error(`Invalid tool: ${key}`);
    const t = tool as {
      name: string;
      description: string;
      inputSchema: Record<string, ZodTypeAny>;
      requiredScopes: string[]; // must exist on all tools (can be empty)
    };
    if (!Array.isArray(t.requiredScopes)) {
      throw new Error(`Tool '${t.name}' is missing requiredScopes array`);
    }
    const jsonSchema = zodFieldMapToJsonSchema(t.inputSchema || {});
    return {
      name: t.name,
      description: t.description,
      // Export full JSON Schema under inputSchema for external docs
      inputSchema: jsonSchema,
      // Preserve tool access requirements for UIs/docs
      requiredScopes: t.requiredScopes,
    };
  });
  return defs.sort(byName);
}

// Skills
async function generateSkillDefinitions() {
  const getSkillsArrayWithCounts =
    skillsModule.getSkillsArrayWithCounts as () => Promise<
      Array<{
        id: string;
        name: string;
        description: string;
        defaultEnabled: boolean;
        order: number;
        toolCount?: number;
      }>
    >;

  if (typeof getSkillsArrayWithCounts !== "function") {
    throw new Error(
      "Failed to import getSkillsArrayWithCounts from src/skills.ts",
    );
  }

  const skills = await getSkillsArrayWithCounts();

  // Return sorted by order (already sorted but being explicit)
  return skills.sort((a, b) => a.order - b.order);
}

async function main() {
  try {
    console.log("Generating tool and skill definitions...");
    const outDir = path.join(__dirname, "../src");
    ensureDirExists(outDir);

    const tools = generateToolDefinitions();
    const skills = await generateSkillDefinitions();

    writeJson(path.join(outDir, "toolDefinitions.json"), tools);
    writeJson(path.join(outDir, "skillDefinitions.json"), skills);

    console.log(
      `✅ Generated: tools(${tools.length}), skills(${skills.length})`,
    );
  } catch (error) {
    const err = error as Error;
    console.error("[ERROR]", err.message, err.stack);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
