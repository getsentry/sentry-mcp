import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, test } from "vitest";
import catalogTools from "./catalog/index.js";
import * as tools from "./index.js";
import {
  TOP_LEVEL_TOOL_NAMES,
  WRAPPER_TOOL_NAMES,
  isDefaultTopLevelToolName,
} from "./surfaces.js";
import { isToolVisibleInMode, resolveDescription } from "./types.js";

// VSCode (via OpenAI) limits to 1024 characters, but its tough to hit that right now,
// so instead lets limit the blast damage and hope that e.g. OpenAI will increase the limit.
const DESCRIPTION_MAX_LENGTH = 2048;
const PUBLIC_TOOL_HARD_LIMIT = 25;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.join(__dirname, "catalog");

function getCatalogToolSourceFiles(): string[] {
  return fs
    .readdirSync(CATALOG_DIR)
    .filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        file !== "index.ts",
    )
    .sort();
}

function getCatalogToolSourceFileName(toolName: string): string {
  return `${toolName.replaceAll("_", "-")}.ts`;
}

test(`all tool descriptions under maximum length`, () => {
  for (const tool of Object.values(tools.default)) {
    const length = resolveDescription(tool.description, {
      experimentalMode: false,
    }).length;
    assert(
      length < DESCRIPTION_MAX_LENGTH,
      `${tool.name} description must be less than ${DESCRIPTION_MAX_LENGTH} characters (was ${length})`,
    );
  }
});

test("all tools declare required MCP safety annotations", () => {
  for (const tool of Object.values(tools.default)) {
    assert(
      typeof tool.annotations.readOnlyHint === "boolean",
      `${tool.name} must define readOnlyHint`,
    );
    assert(
      typeof tool.annotations.openWorldHint === "boolean",
      `${tool.name} must define openWorldHint`,
    );

    if (tool.annotations.readOnlyHint === false) {
      assert(
        typeof tool.annotations.destructiveHint === "boolean",
        `${tool.name} must define destructiveHint because it mutates upstream state`,
      );
    } else {
      assert(
        tool.annotations.destructiveHint !== true,
        `${tool.name} cannot be read-only and destructive`,
      );
    }
  }
});

test("public tool count stays within the hard limit in all modes", () => {
  for (const experimentalMode of [false, true]) {
    const visibleTools = Object.entries(tools.default).filter(
      ([toolName, tool]) =>
        isDefaultTopLevelToolName(toolName) &&
        isToolVisibleInMode(tool, experimentalMode),
    );

    assert(
      visibleTools.length <= PUBLIC_TOOL_HARD_LIMIT,
      `public non-agent tool count must stay at or below ${PUBLIC_TOOL_HARD_LIMIT} in ${experimentalMode ? "experimental" : "stable"} mode (was ${visibleTools.length})`,
    );
  }
});

test("central direct exposure policy references existing tools", () => {
  const toolNames = new Set(Object.keys(tools.default));

  for (const toolName of TOP_LEVEL_TOOL_NAMES) {
    assert(toolNames.has(toolName), `top-level tool '${toolName}' must exist`);
  }

  for (const toolName of WRAPPER_TOOL_NAMES) {
    assert(toolNames.has(toolName), `wrapper tool '${toolName}' must exist`);
    assert(
      !isDefaultTopLevelToolName(toolName),
      `wrapper tool '${toolName}' must not be directly exposed by default`,
    );
  }
});

test("tool registry keys match tool names", () => {
  for (const [toolName, tool] of Object.entries(tools.default)) {
    assert.equal(
      tool.name,
      toolName,
      `tool registry key '${toolName}' must match tool name '${tool.name}'`,
    );
  }
});

test("catalog tools have colocated inline snapshot baseline tests", () => {
  const expectedSourceFiles = Object.values(catalogTools)
    .map((tool) => getCatalogToolSourceFileName(tool.name))
    .sort();

  assert.deepEqual(
    getCatalogToolSourceFiles(),
    expectedSourceFiles,
    "catalog tool source files must match the catalog registry",
  );

  for (const tool of Object.values(catalogTools)) {
    const sourceFile = getCatalogToolSourceFileName(tool.name);
    const testFile = sourceFile.replace(/\.ts$/, ".test.ts");
    const testPath = path.join(CATALOG_DIR, testFile);

    assert(
      fs.existsSync(testPath),
      `catalog tool '${tool.name}' must have a colocated ${testFile}`,
    );

    const testContents = fs.readFileSync(testPath, "utf8");
    assert(
      testContents.includes("toMatchInlineSnapshot("),
      `catalog tool '${tool.name}' must include a baseline inline snapshot test in ${testFile}`,
    );
  }
});
