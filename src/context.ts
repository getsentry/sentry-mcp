/**
 * Stricli Context
 *
 * Provides dependency injection for CLI commands.
 * Following Stricli's "context" pattern for testability.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { StricliContext } from "@stricli/core";

export interface SryContext extends StricliContext {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly homeDir: string;
  readonly configDir: string;
}

export function buildContext(process: NodeJS.Process): SryContext {
  const homeDir = homedir();
  const configDir = join(homeDir, ".sry");

  return {
    process,
    env: process.env,
    cwd: process.cwd(),
    homeDir,
    configDir,
  };
}
