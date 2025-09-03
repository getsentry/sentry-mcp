import { assert, test } from "vitest";
import * as tools from "./index.js";

// VSCode (via OpenAI) limits to 1024 characters, but its tough to hit that right now,
// so instead lets limit the blast damage and hope that e.g. OpenAI will increase the limit.
const DESCRIPTION_MAX_LENGTH = 2048;

test(`all tool descriptions under maximum length`, () => {
  for (const tool of Object.values(tools.default)) {
    const length = tool.description.length;
    assert(
      length < DESCRIPTION_MAX_LENGTH,
      `${tool.name} description must be less than ${DESCRIPTION_MAX_LENGTH} characters (was ${length})`,
    );
  }
});

test(`all tools have requiredScopes defined`, () => {
  for (const [toolName, tool] of Object.entries(tools.default)) {
    assert(
      tool.requiredScopes !== undefined,
      `Tool "${toolName}" must have requiredScopes defined (even if it's an empty array)`,
    );
    assert(
      Array.isArray(tool.requiredScopes),
      `Tool "${toolName}" requiredScopes must be an array`,
    );
  }
});
