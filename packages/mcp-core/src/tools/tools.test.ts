import { assert, test } from "vitest";
import * as tools from "./index.js";
import { isToolVisibleInMode } from "./types.js";

// VSCode (via OpenAI) limits to 1024 characters, but its tough to hit that right now,
// so instead lets limit the blast damage and hope that e.g. OpenAI will increase the limit.
const DESCRIPTION_MAX_LENGTH = 2048;
const PUBLIC_TOOL_HARD_LIMIT = 25;

test(`all tool descriptions under maximum length`, () => {
  for (const tool of Object.values(tools.default)) {
    const length = tool.description.length;
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
    const visibleTools = Object.values(tools.default).filter(
      (tool) => isToolVisibleInMode(tool, experimentalMode) && !tool.agentOnly,
    );

    assert(
      visibleTools.length <= PUBLIC_TOOL_HARD_LIMIT,
      `public non-agent tool count must stay at or below ${PUBLIC_TOOL_HARD_LIMIT} in ${experimentalMode ? "experimental" : "stable"} mode (was ${visibleTools.length})`,
    );
  }
});
