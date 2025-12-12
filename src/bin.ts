#!/usr/bin/env bun
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";

run(app, process.argv.slice(2), buildContext(process));
