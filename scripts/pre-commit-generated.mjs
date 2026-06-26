#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const GENERATED_TASKS = [
  {
    name: "MCP tool and skill definitions",
    command: ["pnpm", "--filter", "@sentry/mcp-core", "generate-definitions"],
    inputs: [
      /^packages\/mcp-core\/src\/tools\/(?!.*\.test\.ts$).*\.ts$/,
      /^packages\/mcp-core\/src\/skills\.ts$/,
      /^packages\/mcp-core\/src\/tools\/surfaces\.ts$/,
      /^packages\/mcp-core\/src\/tools\/types\.ts$/,
      /^packages\/mcp-core\/src\/internal\/tool-helpers\/tool-call-formatting\.ts$/,
      /^packages\/mcp-core\/scripts\/generate-definitions\.ts$/,
      /^plugins\/sentry-mcp\/agents\/sentry-mcp\.md$/,
      /^plugins\/sentry-mcp-experimental\/agents\/sentry-mcp\.md$/,
    ],
    outputs: [
      "packages/mcp-core/src/toolDefinitions.json",
      "packages/mcp-core/src/skillDefinitions.json",
      "plugins/sentry-mcp/agents/sentry-mcp.md",
      "plugins/sentry-mcp-experimental/agents/sentry-mcp.md",
    ],
  },
];

function run(command, options = {}) {
  execFileSync(command[0], command.slice(1), {
    stdio: options.stdio ?? "inherit",
  });
}

function getStagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"],
    { encoding: "utf8" },
  );

  return output.split("\n").filter(Boolean);
}

const stagedFiles = getStagedFiles();

if (stagedFiles.length === 0) {
  process.exit(0);
}

let ranTask = false;

for (const task of GENERATED_TASKS) {
  const shouldRun = stagedFiles.some((file) =>
    task.inputs.some((pattern) => pattern.test(file)),
  );

  if (!shouldRun) {
    continue;
  }

  console.log(`Generating ${task.name}...`);
  run(task.command);
  run(["git", "add", ...task.outputs]);
  ranTask = true;
}

if (!ranTask) {
  console.log("No generated files need updating for staged changes.");
}
