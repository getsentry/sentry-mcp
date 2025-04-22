import { assert, test } from "vitest";
import { TOOL_DEFINITIONS } from "./toolDefinitions";

// VSCode (via OpenAI) limits to 1024 characters, but its tough to hit that right now,
// so instead lets limit the blast damage and hope that e.g. OpenAI will increase the limit.
const DESCRIPTION_MAX_LENGTH = 2048;

test(`all tool definitions under maximum length`, () => {
  for (const tool of TOOL_DEFINITIONS) {
    const length = tool.description.length;
    assert(
      length < DESCRIPTION_MAX_LENGTH,
      `${tool.name} description must be less than ${DESCRIPTION_MAX_LENGTH} characters (was ${length})`,
    );
  }
});
