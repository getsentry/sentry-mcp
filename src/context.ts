/**
 * Stricli Context
 *
 * Provides dependency injection for CLI commands.
 * Following Stricli's "context" pattern for testability.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "@stricli/core";
import type { Writer } from "./types/index.js";

export interface SentryContext extends CommandContext {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly homeDir: string;
  readonly configDir: string;
  readonly stdout: Writer;
  readonly stderr: Writer;
}

export function buildContext(process: NodeJS.Process): SentryContext {
  const homeDir = homedir();
  const configDir = join(homeDir, ".sentry-cli-next");

  return {
    process,
    env: process.env,
    cwd: process.cwd(),
    homeDir,
    configDir,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
