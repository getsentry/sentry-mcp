#!/usr/bin/env bun
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { formatError, getExitCode } from "./lib/errors.js";

try {
  await run(app, process.argv.slice(2), buildContext(process));
} catch (error) {
  process.stderr.write(`Error: ${formatError(error)}\n`);
  process.exit(getExitCode(error));
}
