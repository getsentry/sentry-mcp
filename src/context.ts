/**
 * Stricli Context
 *
 * Provides dependency injection for CLI commands.
 * Following Stricli's "context" pattern for testability.
 */

import { homedir } from "node:os";
import type { CommandContext } from "@stricli/core";
import { getConfigDir } from "./lib/db/index.js";
import { type Span, setCommandSpanName } from "./lib/telemetry.js";
import type { Writer } from "./types/index.js";

export interface SentryContext extends CommandContext {
  readonly process: NodeJS.Process;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly homeDir: string;
  readonly configDir: string;
  readonly stdout: Writer;
  readonly stderr: Writer;
  readonly stdin: NodeJS.ReadStream & { fd: 0 };
  /**
   * Command path segments set by Stricli's `forCommand` callback.
   *
   * Contains the full prefix including the program name, e.g.,
   * `["sentry", "issue", "list"]`. Used by `buildCommand` to show
   * help when a user passes `help` as a positional argument.
   */
  readonly commandPrefix?: readonly string[];
}

/**
 * Build a dynamic context that uses forCommand to set telemetry tags.
 *
 * The forCommand method is called by stricli with the command prefix
 * (e.g., ["auth", "login"]) before running the command.
 *
 * @param process - The Node.js process object
 * @param span - The telemetry span from withTelemetry (optional)
 */
export function buildContext(process: NodeJS.Process, span?: Span) {
  const baseContext: SentryContext = {
    process,
    env: process.env,
    cwd: process.cwd(),
    homeDir: homedir(),
    configDir: getConfigDir(),
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
  };

  return {
    ...baseContext,
    forCommand: ({ prefix }: { prefix: readonly string[] }): SentryContext => {
      setCommandSpanName(span, prefix.join("."));
      return { ...baseContext, commandPrefix: prefix };
    },
  };
}
