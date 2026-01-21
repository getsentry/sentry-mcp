#!/usr/bin/env bun
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";

try {
  await run(app, process.argv.slice(2), buildContext(process));
} catch (err) {
  process.stderr.write(`${error("Error:")} ${formatError(err)}\n`);
  process.exit(getExitCode(err));
}
