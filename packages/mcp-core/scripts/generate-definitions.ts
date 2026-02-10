#!/usr/bin/env tsx
/**
 * Generate tool and skill definitions JSON for external consumption.
 *
 * Outputs to src/ so they can be bundled and imported by clients and the Cloudflare app.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
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

function zodFieldMapToJsonSchema(
  fieldMap: Record<string, ZodTypeAny>,
): unknown {
  if (!fieldMap || Object.keys(fieldMap).length === 0) return {};
  const obj = z.object(fieldMap);
  return zodToJsonSchema(obj, { $refStrategy: "none" });
}

// Plugin variants whose agent frontmatter gets synced by this script.
// Add new entries here when creating a new plugin variant.
const PLUGIN_AGENT_DIRS = ["sentry-mcp", "sentry-mcp-experimental"];
const PLUGINS_DIR = path.join(__dirname, "../../../plugins");

function agentPaths(): string[] {
  return PLUGIN_AGENT_DIRS.map((dir) =>
    path.join(PLUGINS_DIR, dir, "agents/sentry-mcp.md"),
  );
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

  // Get tools to build tool arrays for each skill
  const toolsDefault = toolsModule.default as
    | Record<string, unknown>
    | undefined;
  if (!toolsDefault || typeof toolsDefault !== "object") {
    throw new Error("Failed to import tools from src/tools/index.ts");
  }

  // Build tools array for each skill
  const skillsWithTools = skills.map((skill) => {
    const skillTools: Array<{
      name: string;
      description: string;
      requiredScopes: string[];
    }> = [];

    for (const [toolName, tool] of Object.entries(toolsDefault)) {
      if (!tool || typeof tool !== "object") {
        continue;
      }

      const t = tool as {
        name: string;
        description: string;
        skills: string[];
        requiredScopes: string[];
      };

      // Check if this tool is enabled by this skill
      if (Array.isArray(t.skills) && t.skills.includes(skill.id)) {
        skillTools.push({
          name: t.name,
          description: t.description,
          requiredScopes: Array.isArray(t.requiredScopes)
            ? t.requiredScopes
            : [],
        });
      }
    }

    // Sort tools alphabetically by name
    skillTools.sort((a, b) => a.name.localeCompare(b.name));

    return {
      ...skill,
      tools: skillTools,
    };
  });

  // Return sorted by order (already sorted but being explicit)
  return skillsWithTools.sort((a, b) => a.order - b.order);
}

function isUpToDate(outDir: string): boolean {
  const toolDefsPath = path.join(outDir, "toolDefinitions.json");
  const skillDefsPath = path.join(outDir, "skillDefinitions.json");

  // Check if output files exist
  if (!fs.existsSync(toolDefsPath) || !fs.existsSync(skillDefsPath)) {
    return false;
  }

  // Check agent frontmatter files exist
  const agents = agentPaths();
  for (const agentPath of agents) {
    if (!fs.existsSync(agentPath)) {
      return false;
    }
  }

  // Get oldest output modification time (JSON files + agent files)
  const outputMtimes = [
    fs.statSync(toolDefsPath).mtimeMs,
    fs.statSync(skillDefsPath).mtimeMs,
    ...agents.map((p) => fs.statSync(p).mtimeMs),
  ];
  const oldestOutputMtime = Math.min(...outputMtimes);

  // Check if any input files are newer than outputs
  const toolsDir = path.join(__dirname, "../src/tools");
  if (fs.existsSync(toolsDir)) {
    const checkDir = (dir: string): boolean => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!checkDir(fullPath)) return false;
        } else if (
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
        ) {
          const mtime = fs.statSync(fullPath).mtimeMs;
          if (mtime > oldestOutputMtime) return false;
        }
      }
      return true;
    };
    if (!checkDir(toolsDir)) return false;
  }

  // Check other input files
  const otherInputs = [
    path.join(__dirname, "../src/skills.ts"),
    path.join(__dirname, "generate-definitions.ts"),
  ];
  for (const inputPath of otherInputs) {
    if (fs.existsSync(inputPath)) {
      const mtime = fs.statSync(inputPath).mtimeMs;
      if (mtime > oldestOutputMtime) return false;
    }
  }

  return true;
}

// Agent frontmatter sync — updates the allowedTools list in agent .md files
function syncAgentFrontmatter(agentPath: string, toolNames: string[]) {
  const content = fs.readFileSync(agentPath, "utf-8");
  const parts = content.split("---");
  if (parts.length < 3) {
    console.warn(`⚠️  Skipping ${agentPath}: no valid YAML frontmatter found`);
    return;
  }

  // parts[0] is empty (before first ---), parts[1] is frontmatter, rest is body
  const frontmatterStr = parts[1];
  const body = parts.slice(2).join("---");

  const frontmatter = YAML.parse(frontmatterStr) as Record<string, unknown>;
  frontmatter.allowedTools = toolNames;

  const updated = `---\n${YAML.stringify(frontmatter)}---${body}`;
  fs.writeFileSync(agentPath, updated);
}

async function main() {
  try {
    const outDir = path.join(__dirname, "../src");
    ensureDirExists(outDir);

    // Skip if outputs are up-to-date
    if (isUpToDate(outDir)) {
      console.log("✅ Definitions are up-to-date, skipping generation");
      return;
    }

    console.log("Generating tool and skill definitions...");

    const tools = generateToolDefinitions();
    const skills = await generateSkillDefinitions();

    writeJson(path.join(outDir, "toolDefinitions.json"), tools);
    writeJson(path.join(outDir, "skillDefinitions.json"), skills);

    // Sync allowedTools in agent frontmatter
    const toolNames = tools.map((t) => t.name);

    let agentsSynced = 0;
    for (const agentPath of agentPaths()) {
      if (fs.existsSync(agentPath)) {
        syncAgentFrontmatter(agentPath, toolNames);
        agentsSynced++;
      }
    }

    console.log(
      `✅ Generated: tools(${tools.length}), skills(${skills.length}), agents(${agentsSynced})`,
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
