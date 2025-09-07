#!/usr/bin/env tsx
/**
 * Generate definitions JSON (tools, prompts, resources) for external consumption.
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
const promptsModule = await import("../src/promptDefinitions.ts");
const resourcesModule = await import("../src/resources.ts");

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

// Prompts
function generatePromptDefinitions() {
  const PROMPT_DEFINITIONS = (
    promptsModule as unknown as {
      PROMPT_DEFINITIONS: Array<{
        name: string;
        description: string;
        paramsSchema?: Record<string, ZodTypeAny>;
      }>;
    }
  ).PROMPT_DEFINITIONS;

  if (!Array.isArray(PROMPT_DEFINITIONS))
    throw new Error("Invalid PROMPT_DEFINITIONS import");

  const defs = PROMPT_DEFINITIONS.map((p) => {
    const fields = p.paramsSchema || {};
    return {
      name: p.name,
      description: p.description,
      // Export full JSON Schema under a uniform key: inputSchema
      inputSchema: zodFieldMapToJsonSchema(fields),
    };
  });
  return defs.sort(byName);
}

// Resources
function generateResourceDefinitions() {
  const RESOURCES = (resourcesModule as unknown as { RESOURCES: unknown[] })
    .RESOURCES;
  const isTemplateResource = (
    resourcesModule as unknown as {
      isTemplateResource: (r: unknown) => boolean;
    }
  ).isTemplateResource;

  if (!Array.isArray(RESOURCES)) throw new Error("Invalid RESOURCES import");

  const defs = RESOURCES.map((resource) => {
    const base = resource as {
      name: string;
      description: string;
      mimeType: string;
    };
    if (isTemplateResource(resource)) {
      const t = resource as { templateString: string };
      const variables = Array.from(
        new Set(
          (t.templateString.match(/\{([a-zA-Z0-9_]+)\}/g) || []).map((m) =>
            m.slice(1, -1),
          ),
        ),
      );
      return {
        kind: "template" as const,
        name: base.name,
        description: base.description,
        mimeType: base.mimeType,
        template: t.templateString,
        variables,
      };
    }
    const u = resource as { uri: string };
    return {
      kind: "uri" as const,
      name: base.name,
      description: base.description,
      mimeType: base.mimeType,
      uri: u.uri,
    };
  });
  return defs.sort(byName);
}

async function main() {
  try {
    console.log("Generating definitions (tools, prompts, resources)...");
    const outDir = path.join(__dirname, "../src");
    ensureDirExists(outDir);

    const tools = generateToolDefinitions();
    const prompts = generatePromptDefinitions();
    const resources = generateResourceDefinitions();

    writeJson(path.join(outDir, "toolDefinitions.json"), tools);
    writeJson(path.join(outDir, "promptDefinitions.json"), prompts);
    writeJson(path.join(outDir, "resourceDefinitions.json"), resources);

    console.log(
      `✅ Generated: tools(${tools.length}), prompts(${prompts.length}), resources(${resources.length})`,
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
