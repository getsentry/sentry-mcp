import { describe, expect, test } from "vitest";
import {
  describeTool,
  executeTool,
} from "../../../../src/lib/init/tools/registry.js";
import type {
  ResolvedInitContext,
  ToolPayload,
} from "../../../../src/lib/init/types.js";

function makeContext(): ResolvedInitContext {
  return {
    directory: "/tmp/test",
    yes: true,
    dryRun: true,
    org: "acme",
    team: "platform",
  };
}

describe("tool registry", () => {
  test("describes tool payloads via the registered definition", () => {
    const payload: ToolPayload = {
      type: "tool",
      operation: "run-commands",
      cwd: "/tmp/test",
      params: { commands: ["npm install @sentry/node"] },
    };

    expect(describeTool(payload)).toBe("Running `npm install @sentry/node`...");
  });

  test("returns an error for unknown operations", async () => {
    const payload = {
      type: "tool",
      operation: "teleport",
      cwd: "/tmp/test",
      params: {},
    } as unknown as ToolPayload;

    const result = await executeTool(payload, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown operation");
  });
});
